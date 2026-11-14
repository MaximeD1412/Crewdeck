import {
  LINK_CODE_TTL_SECONDS,
  type BrowserPairing,
  type ConfirmPairing,
  RUNNER_WS_CLOSE,
  type Runner,
  type RunnerLinkAccepted,
  type RunnerLinkCodeCreated,
  type RunnerLinkFailure as RunnerLinkFailureBody,
  type RunnerLinkRequest,
  type RunnerPairing,
  type RunnerLinkStatus,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { newRunnerToken, runnerTokenHash } from '../../auth/runner-tokens.js';
import { AppError, conflict, notFound, unprocessable } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { Prisma } from '../../generated/prisma/client.js';
import { drawShortId, newId } from '../../ids.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { assertFresh } from '../../realtime/freshness.js';
import { Transactions, type Tx } from '../../realtime/transactions.js';
import { Devices } from '../../devices/devices.service.js';
import { runInPilotScope } from '../../scope/scope.context.js';
import { RunnerClock } from '../clock.js';
import { RunnerConnections } from '../runner-connections.js';
import { RunnerProtocol } from '../protocol-version.js';
import { RUNNER_VIEW, toRunner } from '../runner.view.js';
import { failureOf, LINK_VIEW, reasonOf, toRunnerLink } from './link-code.view.js';
import { RunnerLinkLookup } from './link-lookup.js';
import { RunnerLinkTokens } from './link-tokens.js';

/** A live code: one a Runner may still link with. */
const LIVE = ['waiting', 'pending'] as const;

/** How many short ids are drawn before giving up, when the drawn one is taken by a live code. */
const SHORT_ID_TRIES = 5;

const codeUnknown = (): AppError => notFound('runner.link-code-unknown', MESSAGES['runner.link-code-unknown']);
const codeExpired = (): AppError => unprocessable('runner.link-code-expired', MESSAGES['runner.link-code-expired']);
const codeUsed = (): AppError => unprocessable('runner.link-code-used', MESSAGES['runner.link-code-used']);
const notPending = (): AppError => conflict('runner.link-not-pending', MESSAGES['runner.link-not-pending']);

const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** The machine a `pending` code keeps, from the Runner's `POST /api/runner/link`. */
type PendingRunner = Omit<RunnerLinkRequest, 'shortId'>;

/**
 * Linking a Runner (ADR 0003, ADR 0004): the page draws a code and sends its
 * short id's pairing (`create`); the binary links with the short id (`link`)
 * and sends its own pairing (`pairing`); the page confirms (`confirm`), which
 * creates the Runner and revokes the previous one; the binary then reads its
 * token once (`status`). Each change of a code writes `runner-link.upserted`
 * in its transaction, in its Pilote's scope; the routes without a session
 * find the Pilote with `RunnerLinkLookup`.
 */
@Injectable()
export class RunnerLinks {
  constructor(
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly clock: RunnerClock,
    private readonly lookup: RunnerLinkLookup,
    private readonly tokens: RunnerLinkTokens,
    private readonly connections: RunnerConnections,
    private readonly protocol: RunnerProtocol,
    private readonly devices: Devices,
  ) {}

  /**
   * A new code of the current Pilote, for the Appareil `namedDeviceId` names
   * (`X-Crewdeck-Device`) or a new one (`Devices.forCode`): the codes still
   * live expire, only the last one is followed by the page.
   */
  async create(pilotId: string, pairing: BrowserPairing, namedDeviceId?: string): Promise<RunnerLinkCodeCreated> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.transactions.run(async (tx) => {
          const now = this.clock.now();
          await tx.runnerLinkCode.updateMany({ where: { state: { in: [...LIVE] } }, data: { state: 'expired', failureReason: 'expired' } });
          const deviceId = await this.devices.forCode(tx, pilotId, namedDeviceId, pairing);
          const row = await tx.runnerLinkCode.create({
            data: {
              id: newId(),
              pilotId,
              shortId: drawShortId(),
              deviceId,
              browserPairing: pairing as Prisma.InputJsonValue,
              expiresAt: new Date(now.getTime() + LINK_CODE_TTL_SECONDS * 1000),
              createdAt: now,
            },
            select: { id: true, shortId: true, expiresAt: true },
          });
          await this.writeEvent(tx, pilotId, row.id);
          return { id: row.id, shortId: row.shortId, expiresAt: row.expiresAt.toISOString(), deviceId };
        });
      } catch (error) {
        // Another Pilote's live code has this short id: draw another.
        if (!isUniqueViolation(error) || attempt >= SHORT_ID_TRIES) throw error;
      }
    }
  }

  /**
   * The binary links with `shortId`: a `waiting` code becomes `pending` with
   * its machine; without a Moteur it fails (`no-engine`). A code already
   * `pending` that another machine links with fails for both
   * (`already-used`): the page could not tell which one is the Pilote's,
   * even when both link at the same time. The future Runner's id is drawn
   * here: the page binds its wrap of the vault key to it.
   */
  async link({ shortId, ...machine }: RunnerLinkRequest): Promise<RunnerLinkAccepted> {
    const owner = await this.lookup.byShortId(shortId);
    if (!owner) throw codeUnknown();
    return this.inScope(owner.pilotId, async (tx) => {
      const row = await this.liveOrSettled(tx, owner.pilotId, owner.id);
      switch (row.state) {
        case 'expired':
          return codeExpired();
        case 'linked':
        case 'failed':
          return codeUsed();
        case 'pending':
          await this.fail(tx, owner.pilotId, owner.id, 'already-used');
          return codeUsed();
        case 'waiting':
          break;
      }
      if (machine.engines.length === 0) {
        await this.fail(tx, owner.pilotId, owner.id, 'no-engine');
        return unprocessable('runner.no-engine', MESSAGES['runner.no-engine']);
      }
      const pendingRunner: PendingRunner = machine;
      // On the state read: a machine that took the code since (its update waited for ours) changes nothing and fails it.
      const { count } = await tx.runnerLinkCode.updateMany({ where: { id: owner.id, state: 'waiting' }, data: { state: 'pending', pendingRunner, runnerId: newId() } });
      if (count === 0) {
        await this.fail(tx, owner.pilotId, owner.id, 'already-used');
        return codeUsed();
      }
      await this.writeEvent(tx, owner.pilotId, owner.id);
      return { linkId: owner.id, browserPairing: row.browserPairing as BrowserPairing };
    });
  }

  /** The Runner's pairing, once, on a `pending` code: the page then confirms. */
  async pairing(linkId: string, pairing: RunnerPairing): Promise<void> {
    const owner = await this.lookup.byId(linkId);
    if (!owner) throw codeUnknown();
    await this.inScope(owner.pilotId, async (tx) => {
      const row = await this.liveOrSettled(tx, owner.pilotId, owner.id);
      if (row.state !== 'pending' || row.runnerPairing !== null) return notPending();
      await tx.runnerLinkCode.update({ where: { id: owner.id }, data: { runnerPairing: pairing as Prisma.InputJsonValue } });
      await this.writeEvent(tx, owner.pilotId, owner.id);
      return undefined;
    });
  }

  /** `install.sh` found a system the Runner is not built for: the code fails, the page says why. */
  async failure({ shortId }: RunnerLinkFailureBody): Promise<void> {
    const owner = await this.lookup.byShortId(shortId);
    if (!owner) throw codeUnknown();
    await this.inScope(owner.pilotId, async (tx) => {
      const row = await this.liveOrSettled(tx, owner.pilotId, owner.id);
      if (row.state === 'expired') return codeExpired();
      if (row.state === 'linked' || row.state === 'failed') return codeUsed();
      await this.fail(tx, owner.pilotId, owner.id, 'unsupported-system');
      return undefined;
    });
  }

  /**
   * The page confirms the current Pilote's `pending` code, once it read the
   * Runner's pairing: the Runner is created with a new token (its hash kept),
   * the previous one revoked and its socket closed with 4401, the code
   * `linked`, its wrap of the vault key stored (`Devices.confirm`). The
   * binary reads the token, the device's proof and its wrap with `status`.
   * An Appareil that does not hold the vault key fails the code
   * (`device-not-trusted`); a pairing the vault refuses changes nothing.
   */
  async confirm(pilotId: string, id: string, pairing: ConfirmPairing, seq: number): Promise<Runner> {
    const token = newRunnerToken();
    const { runner, revoked, linkedPairing } = await this.inScope(pilotId, async (tx) => {
      const row = await tx.runnerLinkCode.findUnique({
        where: { id },
        select: { state: true, runnerPairing: true, pendingRunner: true, runnerId: true, deviceId: true, expiresAt: true, lastSeq: true },
      });
      if (!row) return codeUnknown();
      assertFresh(row.lastSeq, BigInt(seq));
      const now = this.clock.now();
      if (row.state === 'pending' && row.expiresAt <= now) {
        await this.expire(tx, pilotId, id);
        return notPending();
      }
      if (row.state !== 'pending' || row.runnerPairing === null || row.pendingRunner === null || row.runnerId === null) return notPending();
      const machine = row.pendingRunner as PendingRunner;
      const vault = await this.devices.confirm(tx, pilotId, row.deviceId, row.runnerId, pairing);
      if (vault === 'not-trusted') await this.fail(tx, pilotId, id, 'device-not-trusted');
      if (vault === 'not-trusted' || vault === 'invalid') return Devices.errorOf(vault);
      const previous = await tx.runner.findMany({ where: { revokedAt: null }, select: { id: true } });
      await tx.runner.updateMany({ where: { revokedAt: null }, data: { revokedAt: now, state: 'offline' } });
      const created = await tx.runner.create({
        data: {
          id: row.runnerId,
          pilotId,
          tokenHash: runnerTokenHash(token),
          machine: machine.machine,
          os: machine.os,
          arch: machine.arch,
          wsl: machine.wsl,
          runnerVersion: machine.runnerVersion,
          protocolVersion: this.protocol.version,
          state: 'offline',
          lastSeenAt: now,
          linkedAt: now,
        },
        select: RUNNER_VIEW,
      });
      const linkedPairing = { proof: pairing.proof, vaultKeyVersion: pairing.vaultKeyVersion, runnerVaultWrap: pairing.runnerVaultWrap };
      await tx.runnerLinkCode.update({ where: { id }, data: { state: 'linked', confirmPairing: linkedPairing } });
      const linked = toRunner(created);
      await this.events.write(tx, pilotId, 'runner.upserted', linked);
      await this.writeEvent(tx, pilotId, id);
      return { runner: linked, revoked: new Set(previous.map((runner) => runner.id)), linkedPairing };
    });
    this.tokens.keep(id, { token, pairing: linkedPairing });
    const socket = this.connections.of(pilotId);
    if (socket && revoked.has(socket.runnerId)) socket.close(RUNNER_WS_CLOSE.unauthorized, 'revoked');
    return runner;
  }

  /**
   * The page found the Runner's proof wrong (the public keys it read were not
   * the ones the secret's holders sent): the `pending` code fails with
   * `pairing-mismatch`, the binary stops, the page draws a new code.
   */
  async reject(pilotId: string, id: string, seq: number): Promise<void> {
    await this.inScope(pilotId, async (tx) => {
      const row = await tx.runnerLinkCode.findUnique({ where: { id }, select: { state: true, lastSeq: true } });
      if (!row) return codeUnknown();
      assertFresh(row.lastSeq, BigInt(seq));
      if (row.state !== 'pending') return notPending();
      await this.fail(tx, pilotId, id, 'pairing-mismatch');
      return undefined;
    });
  }

  /** What the binary polls: `pending`, `linked` (its token the first time), or `failed` with the reason. */
  async status(linkId: string): Promise<RunnerLinkStatus> {
    const owner = await this.lookup.byId(linkId);
    if (!owner) throw codeUnknown();
    return this.inScope(owner.pilotId, async (tx) => {
      const row = await this.liveOrSettled(tx, owner.pilotId, owner.id);
      switch (row.state) {
        case 'waiting':
        case 'pending':
          return { state: 'pending' };
        case 'expired':
          return { state: 'failed', reason: 'expired' };
        case 'failed':
          return { state: 'failed', reason: row.failureReason ? reasonOf(row.failureReason) : 'already-used' };
        case 'linked': {
          const handoff = this.tokens.take(owner.id);
          return {
            state: 'linked',
            ...(row.runnerId ? { runnerId: row.runnerId } : {}),
            ...(handoff ? { token: handoff.token, pairing: handoff.pairing } : {}),
          };
        }
      }
    });
  }

  /** The live codes whose 10 minutes are over expire (`RunnerLinkSweep`); how many did. */
  async expireDue(now = this.clock.now()): Promise<number> {
    let expired = 0;
    for (const owner of await this.lookup.expiredAt(now)) {
      const changed = await runInPilotScope(owner.pilotId, () =>
        this.transactions.run(async (tx) => {
          const { count } = await tx.runnerLinkCode.updateMany({
            where: { id: owner.id, state: { in: [...LIVE] }, expiresAt: { lte: now } },
            data: { state: 'expired', failureReason: 'expired' },
          });
          if (count > 0) await this.writeEvent(tx, owner.pilotId, owner.id);
          return count > 0;
        }),
      );
      if (changed) expired++;
    }
    return expired;
  }

  /**
   * Runs `fn` in a transaction of `pilotId`'s scope. An `AppError` it returns
   * is thrown once the transaction committed: what it changed before (a code
   * failed, expired) stays.
   */
  private async inScope<T>(pilotId: string, fn: (tx: Tx) => Promise<T | AppError>): Promise<T> {
    const result = await runInPilotScope(pilotId, () => this.transactions.run(fn));
    if (result instanceof AppError) throw result;
    return result;
  }

  /** The code, expired first when its 10 minutes are over and it was still live. */
  private async liveOrSettled(tx: Tx, pilotId: string, id: string) {
    const select = { state: true, failureReason: true, browserPairing: true, runnerPairing: true, runnerId: true, expiresAt: true } as const;
    const row = await tx.runnerLinkCode.findUniqueOrThrow({ where: { id }, select });
    if ((row.state === 'waiting' || row.state === 'pending') && row.expiresAt <= this.clock.now()) {
      await this.expire(tx, pilotId, id);
      return { ...row, state: 'expired' as const, failureReason: 'expired' as const };
    }
    return row;
  }

  private async expire(tx: Tx, pilotId: string, id: string): Promise<void> {
    await tx.runnerLinkCode.update({ where: { id }, data: { state: 'expired', failureReason: 'expired' } });
    await this.writeEvent(tx, pilotId, id);
  }

  private async fail(tx: Tx, pilotId: string, id: string, reason: 'already-used' | 'no-engine' | 'unsupported-system' | 'pairing-mismatch' | 'device-not-trusted'): Promise<void> {
    await tx.runnerLinkCode.update({ where: { id }, data: { state: 'failed', failureReason: failureOf(reason) } });
    await this.writeEvent(tx, pilotId, id);
  }

  /** `runner-link.upserted` with the code as the page sees it; the row keeps the event's `seq`. */
  private async writeEvent(tx: Tx, pilotId: string, id: string): Promise<void> {
    const row = await tx.runnerLinkCode.findUniqueOrThrow({ where: { id }, select: LINK_VIEW });
    const seq = await this.events.write(tx, pilotId, 'runner-link.upserted', toRunnerLink(row));
    await tx.runnerLinkCode.update({ where: { id }, data: { lastSeq: seq } });
  }
}
