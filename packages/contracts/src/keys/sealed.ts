import { z } from 'zod';
import { zBytes } from './pairing.js';

/**
 * An item sealed under the vault key (`Vault.sealItem`, `docs/security/e2e.md`
 * « Items under the vault key »): its own key wrapped by the vault key
 * (12 + 32 + 16 bytes) and the AES-256-GCM ciphertext of its plaintext.
 * Opaque to the server; the additional data names what it belongs to.
 */
export const zSealedItem = z.strictObject({ key: zBytes(60, 60), ciphertext: zBytes(16, 65536) });
export type SealedItem = z.infer<typeof zSealedItem>;
