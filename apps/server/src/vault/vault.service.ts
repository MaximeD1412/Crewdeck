import { type Device, VAULT_ITEMS_PAGE, type Vault, type VaultHolderType, type VaultItems, type VaultRotation, type VaultState, zId } from '@crewdeck/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { DeviceClock } from '../devices/device-clock.js';
import { DEVICE_VIEW, toDevice, wrapColumns, writeDeviceUpserted } from '../devices/device.view.js';
import { deviceUnknown } from '../devices/devices.service.js';
import { type AppError, conflict, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { newId } from '../ids.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { assertFresh } from '../realtime/freshness.js';
import { afterCommit, Transactions, type Tx } from '../realtime/transactions.js';
import { RunnerCommands } from '../runners/runner-commands.service.js';
import { dropHolders, vaultHoldersOf, vaultStateOf, writeVaultUpserted } from './vault-holders.js';
import { decodeVaultCursor, encodeVaultCursor, VaultItemsRegistry } from './vault-items.js';

/** A rotation of thousands of item keys takes longer than Prisma's 5 s. */
const ROTATION_TIMEOUT_MS = 120_000;

const versionChanged = (): AppError => conflict('vault.version-changed', MESSAGES['vault.version-changed']);
const holdersMissing = (): AppError => unprocessable('vault.holders-missing', MESSAGES['vault.holders-missing']);
const itemsMissing = (): AppError => unprocessable('vault.items-missing', MESSAGES['vault.items-missing']);
const cursorInvalid = (): AppError => unprocessable('vault.cursor-invalid', MESSAGES['vault.cursor-invalid'], { cursor: MESSAGES['vault.cursor-invalid'] });

/** Who rotates: a trusted Appareil the page named, or the token's Runner. */
export interface Rotator {
  readonly type: VaultHolderType;
  readonly id: string;
}

/**
 * The revocation of an Appareil and the rotation of the vault key (ADR 0003,
 * E2E-4, `docs/security/e2e.md` « Revocation and rotation »). The server
 * stores what a holder sealed and checks who receives it, never a key.
 */
@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly clock: DeviceClock,
    private readonly registry: VaultItemsRegistry,
    private readonly runners: RunnerCommands,
  ) {}

  /** The `vault` slice, in the snapshot's transaction. */
  state(tx: Tx, pilotId: string): Promise<VaultState> {
    return vaultStateOf(tx, pilotId);
  }

  /** `GET /api/vault`: the state, the holders and the `seq` a rotation carries. */
  vault(pilotId: string): Promise<Vault> {
    return this.transactions.run(async (tx) => {
      const pilot = await tx.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { vaultKeyVersion: true, vaultRotationPending: true, vaultLastSeq: true } });
      return { version: pilot.vaultKeyVersion, rotationPending: pilot.vaultRotationPending, holders: await vaultHoldersOf(tx), seq: Number(pilot.vaultLastSeq) };
    });
  }

  /** `GET /api/vault/items?cursor=`: a page of item keys; 422 `vault.cursor-invalid` for a cursor it did not give. */
  items(cursor: string | undefined): Promise<VaultItems> {
    const from = cursor === undefined ? { kind: 0, after: null } : decodeVaultCursor(cursor, this.registry.size);
    if (!from) throw cursorInvalid();
    return this.transactions.run(async (tx) => {
      const { items, next } = await this.registry.page(tx, from, VAULT_ITEMS_PAGE);
      return { items, nextCursor: next ? encodeVaultCursor(next) : null };
    });
  }

  /**
   * The rotation, in one transaction or nothing: every holder's wrap of the
   * new version stored, the older ones deleted, every item key replaced, the
   * version moved and the rotation done, with `vault.upserted`. The Runner
   * gets its wrap in `vault.rotated` when another holder rotated.
   */
  rotate(pilotId: string, rotator: Rotator, rotation: VaultRotation): Promise<VaultState> {
    return this.transactions.run(
      async (tx) => {
        await this.events.lock(tx, pilotId);
        const pilot = await tx.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { vaultKeyVersion: true, vaultLastSeq: true } });
        if (pilot.vaultKeyVersion === 0 || rotation.fromVersion !== pilot.vaultKeyVersion) throw versionChanged();
        assertFresh(pilot.vaultLastSeq, BigInt(rotation.seq));

        const holders = await vaultHoldersOf(tx);
        const wanted = new Set(holders.map(({ type, id }) => `${type}:${id}`));
        const given = new Set(rotation.wraps.map(({ holderType, holderId }) => `${holderType}:${holderId}`));
        if (!wanted.has(`${rotator.type}:${rotator.id}`) || given.size !== rotation.wraps.length || given.size !== wanted.size || [...given].some((holder) => !wanted.has(holder))) {
          throw holdersMissing();
        }

        const stored = await this.registry.all(tx);
        const rewrapped = new Map(rotation.items.map((item) => [`${item.itemType}:${item.itemId}`, item]));
        if (rewrapped.size !== rotation.items.length || rewrapped.size !== stored.size || [...rewrapped.keys()].some((key) => !stored.has(key))) throw itemsMissing();
        for (const item of rotation.items) {
          const replaced = await this.registry.kind(item.itemType)?.replace(tx, item.itemId, item.wrappedKey);
          if (!replaced) throw itemsMissing();
        }

        const now = this.clock.now();
        await tx.vaultKeyWrap.createMany({
          data: rotation.wraps.map((wrap) => ({ id: newId(), pilotId, holderType: wrap.holderType, holderId: wrap.holderId, vaultKeyVersion: rotation.toVersion, ...wrapColumns(wrap), createdAt: now })),
        });
        await tx.vaultKeyWrap.deleteMany({ where: { vaultKeyVersion: { lt: rotation.toVersion } } });
        await tx.pilot.update({ where: { id: pilotId }, data: { vaultKeyVersion: rotation.toVersion, vaultRotationPending: false } });
        const state = await writeVaultUpserted(this.events, tx, pilotId);

        const runnerWrap = rotation.wraps.find(({ holderType }) => holderType === 'runner');
        if (rotator.type !== 'runner' && runnerWrap) {
          const vaultKeyWrap = { vaultKeyVersion: rotation.toVersion, enc: runnerWrap.enc, ciphertext: runnerWrap.ciphertext, tag: runnerWrap.tag };
          afterCommit(tx, () => this.tell(pilotId, { type: 'vault.rotated', vaultKeyWrap }));
        }
        return state;
      },
      { timeout: ROTATION_TIMEOUT_MS },
    );
  }

  /**
   * `POST /api/devices/:id/revoke`: the Appareil `revoked`, its wraps
   * deleted, and the rotation pending when it held one, with `device.upserted`
   * and `vault.upserted`; the Runner told when it is connected. An Appareil
   * already revoked changes nothing. 404 for another Pilote's, 409 stale.
   */
  revokeDevice(pilotId: string, id: string, seq: number): Promise<Device> {
    const parsed = zId.safeParse(id);
    if (!parsed.success) throw deviceUnknown();
    return this.transactions.run(async (tx) => {
      const device = await tx.device.findUnique({ where: { id: parsed.data }, select: { ...DEVICE_VIEW, lastSeq: true } });
      if (!device) throw deviceUnknown();
      if (device.state === 'revoked') return toDevice(device);
      assertFresh(device.lastSeq, BigInt(seq));
      // A pending Appareil's code dies with it: an approval needs it `pending`.
      const row = await tx.device.update({ where: { id: parsed.data }, data: { state: 'revoked', revokedAt: this.clock.now(), shortId: null }, select: DEVICE_VIEW });
      const revoked = toDevice(row);
      await writeDeviceUpserted(this.events, tx, pilotId, revoked);
      if (await dropHolders(this.events, tx, pilotId, 'device', [parsed.data])) afterCommit(tx, () => this.tell(pilotId, { type: 'vault.rotation-pending' }));
      return revoked;
    });
  }

  /** Tells the connected Runner; an offline one reads the same in its next `hello.accepted`. */
  private tell(pilotId: string, message: Parameters<RunnerCommands['send']>[1]): void {
    try {
      this.runners.send(pilotId, message);
    } catch {
      this.logger.debug({ type: message.type }, 'the Runner is offline: its next hello.accepted says it');
    }
  }
}
