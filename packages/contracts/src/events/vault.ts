import { type VaultState, zVaultState } from '../api/vault.js';
import { registerEventPayload } from './index.js';

/** `vault.upserted`: the vault's version and its pending rotation, when a revocation or a rotation moves them (E2E-4). */
export const zVaultEventPayload = registerEventPayload('vault', zVaultState);

declare module './index.js' {
  interface EventPayloads {
    vault: VaultState;
  }
}
