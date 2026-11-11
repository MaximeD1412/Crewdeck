import {
  type ApproveDevice,
  type ApproverType,
  DEVICE_CODE_TTL_SECONDS,
  type Device,
  type DeviceApproval,
  type DeviceCreated,
  type NewDeviceRequest,
  PENDING_DEVICES_MAX,
  type PendingDevice,
  zId,
  zRunnerPairing,
  zShortId,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { type AppError, conflict, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { Prisma } from '../generated/prisma/client.js';
import { drawShortId, newId } from '../ids.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { DeviceClock } from './device-clock.js';
import { bytesOf, DEVICE_VIEW, textOf, toDevice, wrapColumns } from './device.view.js';
import { deviceNotTrusted, deviceUnknown } from './devices.service.js';

const SHORT_ID_TRIES = 5;

const codeUnknown = (): AppError => notFound('devices.code-unknown', MESSAGES['devices.code-unknown']);
const notPending = (): AppError => conflict('devices.not-pending', MESSAGES['devices.not-pending']);
const tooManyPending = (): AppError => unprocessable('devices.too-many-pending', MESSAGES['devices.too-many-pending']);
const approvalInvalid = (): AppError => unprocessable('devices.approval-invalid', MESSAGES['devices.approval-invalid']);

const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** A code waits while its Appareil is `pending`, its short id kept and its expiry ahead. */
const live = (now: Date) => ({ state: 'pending', shortId: { not: null }, expiresAt: { gt: now } }) as const;

/**
 * Who approves, as the route knows them: a trusted Appareil the page named in
 * `X-Crewdeck-Device` (session), or the Runner of the token.
 */
export type Approving = { readonly type: 'device'; readonly namedId: string | undefined } | { readonly type: 'runner'; readonly runnerId: string };

/**
 * A new Appareil approved by its code (ADR 0003, E2E-3, `docs/security/e2e.md`
 * « New Appareil »). The server keeps the new public key with `proof_N`, then
 * the approver's public key with `proof_A` and the wrap it sealed; it can
 * check neither proof (the secret never reaches it), only that the approver
 * is the trusted Appareil or the Runner that asks.
 */
@Injectable()
export class DeviceApprovals {
  constructor(
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly clock: DeviceClock,
  ) {}

  /** A new `pending` Appareil of the current Pilote, its code live for 10 minutes; 422 past 3 live codes. */
  async register(pilotId: string, request: NewDeviceRequest): Promise<DeviceCreated> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.transactions.run(async (tx) => {
          const now = this.clock.now();
          // An expired code frees its short id.
          await tx.device.updateMany({ where: { state: 'pending', shortId: { not: null }, expiresAt: { lte: now } }, data: { shortId: null } });
          if ((await tx.device.count({ where: live(now) })) >= PENDING_DEVICES_MAX) throw tooManyPending();
          const row = await tx.device.create({
            data: {
              id: newId(),
              pilotId,
              name: request.name,
              publicKey: bytesOf(request.publicKey),
              proof: bytesOf(request.proof),
              shortId: drawShortId(),
              expiresAt: new Date(now.getTime() + DEVICE_CODE_TTL_SECONDS * 1000),
              createdAt: now,
            },
            select: { ...DEVICE_VIEW, shortId: true, expiresAt: true },
          });
          await this.events.write(tx, pilotId, 'device.upserted', toDevice(row));
          return { id: row.id, shortId: row.shortId ?? '', expiresAt: row.expiresAt?.toISOString() ?? '' };
        });
      } catch (error) {
        // Another live code of the Pilote has this short id: draw another.
        if (!isUniqueViolation(error) || attempt >= SHORT_ID_TRIES) throw error;
      }
    }
  }

  /** The current Pilote's Appareil whose code is live with `shortId`: 404 when there is none. */
  pending(shortId: string): Promise<PendingDevice> {
    const parsed = zShortId.safeParse(shortId);
    if (!parsed.success) throw codeUnknown();
    return this.transactions.run(async (tx) => {
      const row = await tx.device.findFirst({
        where: { ...live(this.clock.now()), shortId: parsed.data },
        select: { id: true, name: true, publicKey: true, proof: true, expiresAt: true },
      });
      if (!row?.proof || !row.expiresAt) throw codeUnknown();
      return { id: row.id, shortId: parsed.data, name: row.name, publicKey: textOf(row.publicKey), proof: textOf(row.proof), expiresAt: row.expiresAt.toISOString() };
    });
  }

  /**
   * The approval of Appareil `id`: it becomes `trusted` with the wrap the
   * approver sealed for its public key, the approver's public key and
   * `proof_A` kept for the new page to check, with its `device.upserted`.
   */
  approve(pilotId: string, id: string, approving: Approving, body: ApproveDevice): Promise<Device> {
    const parsed = zId.safeParse(id);
    if (!parsed.success) throw deviceUnknown();
    return this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const device = await tx.device.findUnique({ where: { id: parsed.data }, select: { state: true, shortId: true, expiresAt: true } });
      if (!device) throw deviceUnknown();
      if (device.state !== 'pending' || !device.shortId || !device.expiresAt || device.expiresAt <= now) throw notPending();
      const approverPublicKey = await this.approverKey(tx, approving, body.approver);
      if (!approverPublicKey) throw deviceNotTrusted();
      const { vaultKeyVersion } = await tx.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { vaultKeyVersion: true } });
      if (vaultKeyVersion === 0 || body.vaultKeyVersion !== vaultKeyVersion) throw approvalInvalid();

      // Only a pending one: two approvals at once, one wins, the other is 409.
      const { count } = await tx.device.updateMany({
        where: { id: parsed.data, state: 'pending' },
        data: {
          state: 'trusted',
          approvedAt: now,
          shortId: null,
          approverType: body.approver.type,
          approverId: body.approver.id,
          approverPublicKey,
          approvalProof: bytesOf(body.proof),
        },
      });
      if (count === 0) throw notPending();
      await tx.vaultKeyWrap.create({
        data: { id: newId(), pilotId, holderType: 'device', holderId: parsed.data, vaultKeyVersion, ...wrapColumns(body.wrap), createdAt: now },
      });
      const row = await tx.device.findUniqueOrThrow({ where: { id: parsed.data }, select: DEVICE_VIEW });
      const approved = toDevice(row);
      await this.events.write(tx, pilotId, 'device.upserted', approved);
      return approved;
    });
  }

  /** Who approved the current Pilote's Appareil `id` by its code, and `proof_A`: 404 for one no code approved. */
  approval(id: string): Promise<DeviceApproval> {
    const parsed = zId.safeParse(id);
    if (!parsed.success) throw deviceUnknown();
    return this.transactions.run(async (tx) => {
      const row = await tx.device.findUnique({
        where: { id: parsed.data },
        select: { state: true, approverType: true, approverId: true, approverPublicKey: true, approvalProof: true },
      });
      if (!row || row.state !== 'trusted' || !row.approverType || !row.approverId || !row.approverPublicKey || !row.approvalProof) throw deviceUnknown();
      return {
        approver: { type: row.approverType, id: row.approverId, publicKey: textOf(row.approverPublicKey) },
        proof: textOf(row.approvalProof),
      };
    });
  }

  /**
   * The public key of the approver the body names, when it is the one that
   * asks and holds the vault key: the trusted Appareil the page named, or the
   * token's Runner (its key from its link); `undefined` otherwise.
   */
  private async approverKey(tx: Tx, approving: Approving, approver: { type: ApproverType; id: string }): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (approving.type !== approver.type) return undefined;
    if (approving.type === 'device') {
      if (approving.namedId !== approver.id) return undefined;
      const device = await tx.device.findUnique({ where: { id: approver.id }, select: { state: true, publicKey: true } });
      return device?.state === 'trusted' ? new Uint8Array(device.publicKey) : undefined;
    }
    if (approving.runnerId !== approver.id) return undefined;
    const link = await tx.runnerLinkCode.findFirst({ where: { runnerId: approver.id, state: 'linked' }, select: { runnerPairing: true } });
    const pairing = zRunnerPairing.safeParse(link?.runnerPairing);
    return pairing.success ? bytesOf(pairing.data.runnerPublicKey) : undefined;
  }
}
