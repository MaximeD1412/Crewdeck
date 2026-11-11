import { type BrowserPairing, type ConfirmPairing, DEVICES_MAX, type Device, type VaultKeyWrap, zId } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { AppError, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { newId } from '../ids.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { DeviceClock } from './device-clock.js';
import { bytesOf, DEVICE_VIEW, toDevice, wrapColumns, wrapOf } from './device.view.js';

/** `lastSeenAt` moves at most once in this time. */
export const DEVICE_SEEN_EVERY_MS = 60 * 60 * 1000;

const deviceUnknown = (): AppError => notFound('devices.not-found', MESSAGES['devices.not-found']);
export const deviceNotTrusted = (): AppError => unprocessable('devices.not-trusted', MESSAGES['devices.not-trusted']);
const deviceRevoked = (): AppError => unprocessable('devices.revoked', MESSAGES['devices.revoked']);
const pairingInvalid = (): AppError => unprocessable('runner.link-pairing-invalid', MESSAGES['runner.link-pairing-invalid']);

/** The id the page named in `X-Crewdeck-Device`, when it is one. */
export const deviceIdOf = (header: string | undefined): string | undefined => {
  const parsed = zId.safeParse(header);
  return parsed.success ? parsed.data : undefined;
};

/** What a confirmation does to the vault: `invalid` and `not-trusted` change nothing. */
export type VaultOutcome = 'created' | 'wrapped' | 'not-trusted' | 'invalid';

/**
 * The Appareils and the vault key's wraps (ADR 0003, E2E-2). The server keeps
 * each holder's public key and wraps, never a secret nor the vault key: it
 * cannot check a proof nor a wrap, only who may receive which wrap.
 */
@Injectable()
export class Devices {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly clock: DeviceClock,
  ) {}

  /**
   * The Appareil of a new link code: the one the page named, if it is the
   * Pilote's with the pairing's public key and not revoked; else a new one,
   * `pending`, with its `device.upserted`.
   */
  async forCode(tx: Tx, pilotId: string, namedId: string | undefined, pairing: BrowserPairing): Promise<string> {
    const publicKey = bytesOf(pairing.devicePublicKey);
    if (namedId) {
      const named = await tx.device.findUnique({ where: { id: namedId }, select: { publicKey: true, state: true } });
      if (named && named.state !== 'revoked' && Buffer.from(named.publicKey).equals(publicKey)) return namedId;
    }
    const row = await tx.device.create({ data: { id: newId(), pilotId, name: pairing.deviceName.trim(), publicKey, createdAt: this.clock.now() }, select: DEVICE_VIEW });
    await this.events.write(tx, pilotId, 'device.upserted', toDevice(row));
    return row.id;
  }

  /**
   * The vault side of a confirmed link, in its transaction. Without a vault
   * yet: both wraps stored at version 1, the Appareil `trusted`, the
   * Pilote's version 1. With one: the confirming Appareil must hold it
   * (`trusted`), and only the new Runner's wrap of the current version is
   * stored.
   */
  async confirm(tx: Tx, pilotId: string, deviceId: string | null, runnerId: string, pairing: ConfirmPairing): Promise<VaultOutcome> {
    const { vaultKeyVersion } = await tx.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { vaultKeyVersion: true } });
    const device = deviceId ? await tx.device.findUnique({ where: { id: deviceId }, select: { state: true } }) : null;
    if (!deviceId || !device || device.state === 'revoked') return 'not-trusted';
    if (vaultKeyVersion === 0) {
      if (pairing.vaultKeyVersion !== 1 || !pairing.deviceVaultWrap) return 'invalid';
      const now = this.clock.now();
      await tx.vaultKeyWrap.createMany({
        data: [
          { id: newId(), pilotId, holderType: 'device', holderId: deviceId, vaultKeyVersion: 1, ...wrapColumns(pairing.deviceVaultWrap), createdAt: now },
          { id: newId(), pilotId, holderType: 'runner', holderId: runnerId, vaultKeyVersion: 1, ...wrapColumns(pairing.runnerVaultWrap), createdAt: now },
        ],
      });
      await tx.pilot.update({ where: { id: pilotId }, data: { vaultKeyVersion: 1 } });
      const row = await tx.device.update({ where: { id: deviceId }, data: { state: 'trusted', approvedAt: now }, select: DEVICE_VIEW });
      await this.events.write(tx, pilotId, 'device.upserted', toDevice(row));
      return 'created';
    }
    if (device.state !== 'trusted') return 'not-trusted';
    if (pairing.vaultKeyVersion !== vaultKeyVersion || pairing.deviceVaultWrap) return 'invalid';
    await tx.vaultKeyWrap.create({
      data: { id: newId(), pilotId, holderType: 'runner', holderId: runnerId, vaultKeyVersion, ...wrapColumns(pairing.runnerVaultWrap), createdAt: this.clock.now() },
    });
    return 'wrapped';
  }

  /** The error of an outcome that confirms nothing. */
  static errorOf(outcome: 'not-trusted' | 'invalid'): AppError {
    return outcome === 'not-trusted' ? deviceNotTrusted() : pairingInvalid();
  }

  /** The current Pilote's Appareils, newest first, `current` the one of `currentId`. */
  async list(currentId: string | undefined): Promise<Device[]> {
    const rows = await this.prisma.scoped.device.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: DEVICES_MAX, select: DEVICE_VIEW });
    return rows.map((row) => toDevice(row, currentId));
  }

  /** The `devices` slice, in the snapshot's transaction. */
  async snapshot(tx: Tx): Promise<Device[]> {
    const rows = await tx.device.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: DEVICES_MAX, select: DEVICE_VIEW });
    return rows.map((row) => toDevice(row));
  }

  /** The current Pilote's Appareil `id`'s wrap of the current vault key: 404 when it is not theirs, 422 when it holds none. */
  async vaultKeyWrap(id: string): Promise<VaultKeyWrap> {
    const parsed = zId.safeParse(id);
    if (!parsed.success) throw deviceUnknown();
    return this.transactions.run(async (tx) => {
      const device = await tx.device.findUnique({ where: { id: parsed.data }, select: { state: true, pilotId: true } });
      if (!device) throw deviceUnknown();
      if (device.state === 'revoked') throw deviceRevoked();
      const { vaultKeyVersion } = await tx.pilot.findUniqueOrThrow({ where: { id: device.pilotId }, select: { vaultKeyVersion: true } });
      const wrap = await tx.vaultKeyWrap.findFirst({ where: { holderType: 'device', holderId: parsed.data, vaultKeyVersion }, select: { enc: true, ciphertext: true, tag: true } });
      if (device.state !== 'trusted' || !wrap) throw deviceNotTrusted();
      return { vaultKeyVersion, ...wrapOf(wrap) };
    });
  }

  /** A Runner's wrap of its Pilote's current vault key, for its `hello.accepted`; none before the first pairing. */
  runnerWrap(pilotId: string, runnerId: string): Promise<VaultKeyWrap | undefined> {
    return runInPilotScope(pilotId, async () => {
      const pilot = await this.prisma.scoped.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { vaultKeyVersion: true } });
      if (pilot.vaultKeyVersion === 0) return undefined;
      const wrap = await this.prisma.scoped.vaultKeyWrap.findFirst({
        where: { holderType: 'runner', holderId: runnerId, vaultKeyVersion: pilot.vaultKeyVersion },
        select: { enc: true, ciphertext: true, tag: true },
      });
      return wrap ? { vaultKeyVersion: pilot.vaultKeyVersion, ...wrapOf(wrap) } : undefined;
    });
  }

  /** The page of the current Pilote named its Appareil: `lastSeenAt` now, if the last one is an hour old or more. */
  async seen(pilotId: string, id: string): Promise<void> {
    const now = this.clock.now();
    await runInPilotScope(pilotId, () => this.transactions.run(async (tx) => {
      const before = new Date(now.getTime() - DEVICE_SEEN_EVERY_MS);
      const { count } = await tx.device.updateMany({
        where: { id, state: { not: 'revoked' }, OR: [{ lastSeenAt: null }, { lastSeenAt: { lte: before } }] },
        data: { lastSeenAt: now },
      });
      if (count === 0) return;
      const row = await tx.device.findUniqueOrThrow({ where: { id }, select: DEVICE_VIEW });
      await this.events.write(tx, pilotId, 'device.upserted', toDevice(row));
    }));
  }
}
