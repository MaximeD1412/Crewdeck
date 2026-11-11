import { z } from 'zod';

/**
 * The first Appareil's pairing (ADR 0003, E2E-2, `docs/security/e2e.md`
 * « First Appareil »): the public keys and the proofs the page and the Runner
 * exchange through the server, then the vault key wrapped for both. Byte
 * strings are base64url without padding; the server reads none of them.
 */

/** The label each proof starts with: one direction's proof never replays as the other's. */
export const PAIRING_PROOF_LABELS = { runner: 'crewdeck/v1/link/runner', device: 'crewdeck/v1/link/device' } as const;

/** The HPKE `info` of a vault key's wrap. */
export const VAULT_WRAP_INFO = 'crewdeck/v1/vault-wrap';

/** The longest name of an Appareil (« Chrome sur Windows »). */
export const DEVICE_NAME_MAX_LENGTH = 60;

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** A byte string of `min` to `max` bytes in base64url without padding (a length of 4n+1 characters is no byte string). */
export const zBytes = (min: number, max: number) =>
  z
    .string()
    .regex(BASE64URL)
    .refine((text) => text.length % 4 !== 1, 'not base64url')
    .refine((text) => {
      const bytes = Math.floor((text.length * 3) / 4);
      return bytes >= min && bytes <= max;
    }, `between ${min} and ${max} bytes`);

/** 32 bytes: an X25519 public key, an HMAC-SHA256, a wrap's `enc` or tag. */
export const zBytes32 = zBytes(32, 32);

/**
 * An authenticated wrap (`sealWrap`): HPKE's `enc` and `ciphertext` and the
 * sender's tag. A vault key's ciphertext is 48 bytes; 1024 leaves room for the
 * other uses.
 */
export const zWrap = z.object({ enc: zBytes32, ciphertext: zBytes(16, 1024), tag: zBytes32 });
export type Wrap = z.infer<typeof zWrap>;

/** The page's pairing, sent with a new code: its Appareil's public key and name. */
export const zBrowserPairing = z.object({
  devicePublicKey: zBytes32,
  deviceName: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
});
export type BrowserPairing = z.infer<typeof zBrowserPairing>;

/**
 * The Runner's pairing: its public key and
 * `HMAC-SHA256(secret, "crewdeck/v1/link/runner" ‖ shortId ‖ runnerPublicKey ‖ devicePublicKey)`.
 */
export const zRunnerPairing = z.object({ runnerPublicKey: zBytes32, proof: zBytes32 });
export type RunnerPairing = z.infer<typeof zRunnerPairing>;

/** A vault key's version: 1 for the first, E2E-4 rotates it. */
export const zVaultKeyVersion = z.int().positive();

/**
 * The page's confirmation: `HMAC-SHA256(secret, "crewdeck/v1/link/device" ‖
 * shortId ‖ devicePublicKey ‖ runnerPublicKey)`, and the vault key wrapped for
 * the Runner and, the first time only, for the Appareil itself (a trusted
 * Appareil relinking a Runner sends no wrap of its own).
 */
export const zConfirmPairing = z.object({
  proof: zBytes32,
  vaultKeyVersion: zVaultKeyVersion,
  runnerVaultWrap: zWrap,
  deviceVaultWrap: zWrap.optional(),
});
export type ConfirmPairing = z.infer<typeof zConfirmPairing>;

/** What the Runner receives once linked: the page's proof and its vault wrap (the Appareil's own wrap is not its business). */
export const zLinkedPairing = z.object({ proof: zBytes32, vaultKeyVersion: zVaultKeyVersion, runnerVaultWrap: zWrap });
export type LinkedPairing = z.infer<typeof zLinkedPairing>;

/** A key holder's vault wrap and the version of the key it wraps. */
export const zVaultKeyWrap = zWrap.extend({ vaultKeyVersion: zVaultKeyVersion });
export type VaultKeyWrap = z.infer<typeof zVaultKeyWrap>;

/** The additional data of a holder's vault wrap: `"<holderId>:<vaultKeyVersion>"` in UTF-8. */
export const vaultWrapAad = (holderId: string, vaultKeyVersion: number): string => `${holderId}:${vaultKeyVersion}`;
