import { type VaultHolder, type VaultHolderType, type VaultState, zRunnerPairing } from '@crewdeck/contracts';
import { textOf } from '../devices/device.view.js';
import type { EventsWriter } from '../realtime/events.writer.js';
import type { Tx } from '../realtime/transactions.js';

/** The vault's state: the `vault` slice and the payload of `vault.upserted`. */
export const vaultStateOf = async (tx: Tx, pilotId: string): Promise<VaultState> => {
  const pilot = await tx.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { vaultKeyVersion: true, vaultRotationPending: true } });
  return { version: pilot.vaultKeyVersion, rotationPending: pilot.vaultRotationPending };
};

/** Writes `vault.upserted` with the vault's state, and keeps its `seq` for the next rotation (ADR 0007). */
export const writeVaultUpserted = async (events: EventsWriter, tx: Tx, pilotId: string): Promise<VaultState> => {
  const state = await vaultStateOf(tx, pilotId);
  const seq = await events.write(tx, pilotId, 'vault.upserted', state);
  await tx.pilot.update({ where: { id: pilotId }, data: { vaultLastSeq: seq } });
  return state;
};

/**
 * A revoked key holder loses its wraps of every version, in the transaction
 * that revokes it; when it held one, the vault key's rotation becomes
 * pending, with `vault.upserted` (E2E-4). `true` when it did.
 */
export const dropHolders = async (events: EventsWriter, tx: Tx, pilotId: string, holderType: VaultHolderType, ids: readonly string[]): Promise<boolean> => {
  if (ids.length === 0) return false;
  const { count } = await tx.vaultKeyWrap.deleteMany({ where: { holderType, holderId: { in: [...ids] } } });
  if (count === 0) return false;
  await tx.pilot.update({ where: { id: pilotId }, data: { vaultRotationPending: true } });
  await writeVaultUpserted(events, tx, pilotId);
  return true;
};

/** The public key the current Runner sent with its link (RUNNER-3), `undefined` without one. */
export const runnerPublicKeyOf = async (tx: Tx, runnerId: string): Promise<string | undefined> => {
  const link = await tx.runnerLinkCode.findFirst({ where: { runnerId, state: 'linked' }, select: { runnerPairing: true } });
  const pairing = zRunnerPairing.safeParse(link?.runnerPairing);
  return pairing.success ? pairing.data.runnerPublicKey : undefined;
};

/** The holders a rotation wraps the new key for: the trusted Appareils, oldest first, then the current Runner. */
export const vaultHoldersOf = async (tx: Tx): Promise<VaultHolder[]> => {
  const devices = await tx.device.findMany({ where: { state: 'trusted' }, orderBy: [{ approvedAt: 'asc' }, { id: 'asc' }], select: { id: true, publicKey: true } });
  const holders: VaultHolder[] = devices.map(({ id, publicKey }) => ({ type: 'device', id, publicKey: textOf(publicKey) }));
  const runner = await tx.runner.findFirst({ where: { revokedAt: null }, select: { id: true } });
  const publicKey = runner ? await runnerPublicKeyOf(tx, runner.id) : undefined;
  if (runner && publicKey) holders.push({ type: 'runner', id: runner.id, publicKey });
  return holders;
};
