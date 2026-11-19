import { ApiError } from '../api/request.js';
import type { Vault } from './vault.js';

/**
 * A write of an item sealed under the vault key (E2E-4, `docs/security/e2e.md`
 * « Revocation and rotation »): `write` seals and sends, the body carrying the
 * version its key was sealed under. The server refuses an older one with 409
 * `vault.version-changed` (another holder rotated): the vault is unlocked
 * again, under its new key, and `write` seals and sends once more, once. Any
 * other refusal, or a vault that does not open again, is the caller's.
 */
export const sealedWrite = async <T>(vault: Pick<Vault, 'unlockVault'>, write: () => Promise<T>): Promise<T> => {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'vault.version-changed') throw error;
    if ((await vault.unlockVault().catch(() => 'locked')) !== 'unlocked') throw error;
    return write();
  }
};
