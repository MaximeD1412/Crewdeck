import type { z } from 'zod';
import { zVaultKeyWrap } from '../keys/pairing.js';
import { runnerMessage } from './envelope.js';

/**
 * Server → Runner, while it is connected (E2E-4): a revocation made the vault
 * key's rotation pending; the Runner rotates it unless a trusted Appareil
 * does first (`docs/security/e2e.md` « Revocation and rotation »).
 */
export const zVaultRotationPending = runnerMessage('vault.rotation-pending');
export type VaultRotationPending = z.infer<typeof zVaultRotationPending>;

/**
 * Server → Runner, while it is connected: a holder rotated the vault key, and
 * this is the Runner's wrap of the new version, which it opens from a public
 * key it authenticated (the rotating holder's) and keeps as `vault.wrap`.
 */
export const zVaultRotated = runnerMessage('vault.rotated', { vaultKeyWrap: zVaultKeyWrap });
export type VaultRotated = z.infer<typeof zVaultRotated>;
