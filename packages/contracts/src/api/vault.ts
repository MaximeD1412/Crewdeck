import { z } from 'zod';
import { withSeq } from './commands.js';
import { DEVICES_MAX } from './devices.js';
import { zBytes, zBytes32, zVaultKeyVersion } from '../keys/pairing.js';
import { zId, zSeq } from '../values.js';

/**
 * The rotation of the vault key (ADR 0003, E2E-4, `docs/security/e2e.md`
 * « Revocation and rotation »). Revoking a key holder (an Appareil, or a
 * Runner a new link replaced) marks the rotation pending; the first trusted
 * holder online draws a new vault key, rewraps every item key under it, wraps
 * it for each holder kept, and posts it all in one rotation.
 */

/** A key holder: an Appareil or the Runner. */
export const VAULT_HOLDER_TYPES = ['device', 'runner'] as const;
export const zVaultHolderType = z.enum(VAULT_HOLDER_TYPES);
export type VaultHolderType = z.infer<typeof zVaultHolderType>;

/**
 * The `vault` slice of `GET /api/state` and the payload of `vault.upserted`:
 * the version of the vault key (0 before the first Appareil), and whether a
 * revocation waits for its rotation.
 */
export const zVaultState = z.object({ version: z.int().nonnegative(), rotationPending: z.boolean() });
export type VaultState = z.infer<typeof zVaultState>;

/** A holder the rotation wraps the new key for: the trusted Appareils and the current Runner. */
export const zVaultHolder = z.object({ type: zVaultHolderType, id: zId, publicKey: zBytes32 });
export type VaultHolder = z.infer<typeof zVaultHolder>;

/**
 * `GET /api/vault` (a trusted Appareil) and `GET /api/runner/vault` (the
 * Runner): the vault's state, its holders, and the `seq` of its last change
 * that the rotation sends back. The rotating holder seals only for the
 * public keys it authenticated itself, never for these as such.
 */
export const zVault = zVaultState.extend({ holders: z.array(zVaultHolder).max(DEVICES_MAX + 1), seq: zSeq });
export type Vault = z.infer<typeof zVault>;

/** An item's kind in the rotation's registry (`idea.text`, `process-version.sealed`). */
export const zVaultItemType = z.string().regex(/^[a-z][a-z-]*\.[a-z][a-z-]*$/).max(64);

/** An item key under the vault key: `aesGcmSeal(vaultKey, itemKey, "crewdeck/v1/item-key" ‖ aad)`, 12 + 32 + 16 bytes. */
export const zWrappedItemKey = zBytes(60, 60);

/**
 * An item key to rewrap: its kind, the row it belongs to, the item's
 * additional data (`"<ideaId>:text"`), and its key under the current vault
 * key. A wrong `aad` only keeps the key from opening.
 */
export const zVaultItem = z.object({ itemType: zVaultItemType, itemId: zId, aad: z.string().min(1).max(200), wrappedKey: zWrappedItemKey });
export type VaultItem = z.infer<typeof zVaultItem>;

/** A page of `GET /api/vault/items` holds at most this many item keys. */
export const VAULT_ITEMS_PAGE = 500;

/** `GET /api/vault/items?cursor=` (and the Runner's `GET /api/runner/vault/items`): every item key under the vault key, page by page. */
export const zVaultItems = z.object({ items: z.array(zVaultItem).max(VAULT_ITEMS_PAGE), nextCursor: z.string().min(1).nullable() });
export type VaultItems = z.infer<typeof zVaultItems>;

/** The new vault key wrapped for one holder, additional data `"<holderId>:<toVersion>"`. */
export const zRotationWrap = z.object({ holderType: zVaultHolderType, holderId: zId, enc: zBytes32, ciphertext: zBytes(16, 1024), tag: zBytes32 });
export type RotationWrap = z.infer<typeof zRotationWrap>;

/**
 * An item key rewrapped under the new vault key, for the same additional
 * data; `previousKey` is the wrapped key the rotating holder read and
 * unwrapped, the one the server must still hold to replace it.
 */
export const zRotatedItem = z.object({ itemType: zVaultItemType, itemId: zId, previousKey: zWrappedItemKey, wrappedKey: zWrappedItemKey });
export type RotatedItem = z.infer<typeof zRotatedItem>;

/** The body of a rotation is bounded at 10 MB; an item takes at most about 320 bytes of it. */
export const VAULT_ROTATION_BODY_MAX_BYTES = 10 * 1024 * 1024;
export const VAULT_ROTATION_ITEMS_MAX = 30_000;

/**
 * `POST /api/vault/rotations` (a trusted Appareil) and
 * `POST /api/runner/vault/rotations` (the Runner), with the `seq` of
 * `GET /api/vault`: in one transaction, every wrap of the new version, every
 * item key rewrapped, the version moved and the rotation done. 409
 * `vault.version-changed` when `fromVersion` is no longer current; 422
 * `vault.holders-missing` unless `wraps` is exactly the holders, 422
 * `vault.items-missing` unless `items` is exactly the registered items; 409
 * `vault.items-changed` when an item's stored key is no longer its
 * `previousKey` (written again since it was read): nothing changes.
 */
export const zVaultRotation = withSeq(
  z.object({
    fromVersion: zVaultKeyVersion,
    toVersion: zVaultKeyVersion,
    wraps: z.array(zRotationWrap).min(1).max(DEVICES_MAX + 1),
    items: z.array(zRotatedItem).max(VAULT_ROTATION_ITEMS_MAX),
  }),
).refine((rotation) => rotation.toVersion === rotation.fromVersion + 1, { path: ['toVersion'], message: 'toVersion vaut fromVersion + 1.' });
export type VaultRotation = z.infer<typeof zVaultRotation>;
