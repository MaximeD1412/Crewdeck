import { conflict } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import type { Tx } from '../realtime/transactions.js';

/**
 * The check of every write of an item sealed under the vault key (E2E-4,
 * `docs/security/e2e.md` « Revocation and rotation »): 409
 * `vault.version-changed` unless `vaultKeyVersion`, the version the page
 * sealed under, is the vault's current one. A rotation moves the version
 * while it holds the Pilote's row; the caller holds it too (an UPDATE of the
 * row earlier in `tx`), so no rotation commits between this check and the
 * write: an item sealed under a key no holder keeps any more is never stored.
 */
export const assertVaultVersion = async (tx: Tx, pilotId: string, vaultKeyVersion: number): Promise<void> => {
  const pilot = await tx.pilot.findUnique({ where: { id: pilotId }, select: { vaultKeyVersion: true } });
  if (pilot?.vaultKeyVersion !== vaultKeyVersion) throw conflict('vault.version-changed', MESSAGES['vault.version-changed']);
};

/**
 * The vault's current version, the Pilote's row held until `tx` ends (the
 * lock of `EventsWriter.lock`): no rotation commits before it, so what `tx`
 * reads or writes of the items sealed under the vault key is under that
 * version (E2E-4).
 */
export const heldVaultVersion = async (tx: Tx, pilotId: string): Promise<number> =>
  (await tx.pilot.update({ where: { id: pilotId }, data: { seq: { increment: 0 } }, select: { vaultKeyVersion: true } })).vaultKeyVersion;
