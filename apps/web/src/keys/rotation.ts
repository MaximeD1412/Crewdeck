import { type RotatedItem, type RotationWrap, type Vault as ServerVault, type VaultItems, type VaultRotation, vaultWrapAad } from '@crewdeck/contracts';
import { type Bytes, fromBase64Url, toBase64Url, utf8 } from './bytes.js';
import { INFO, aesGcmOpen, aesGcmSeal, constantTimeEqual, exportAesKey, generateAesKey, importAesKey, sealWrap } from './crypto.js';
import type { DeviceStore, StoredDevice } from './device-store.js';
import { itemKeyAad, type Vault } from './vault.js';

/**
 * The rotation of the vault key from a trusted Appareil (ADR 0003, E2E-4,
 * `docs/security/e2e.md` « Revocation and rotation »): once a holder was
 * revoked, a new vault key, every item key rewrapped under it, the new key
 * wrapped for each holder kept, in one `POST /api/vault/rotations`.
 *
 * It seals only for keys this Appareil authenticated itself: its own, and the
 * Runner's (from its pairing or handed on with `proof_R`). The Runner holds
 * this Appareil's key, so it opens its wrap; another Appareil does not (its
 * approver kept only its own approver's), so with one kept the Runner rotates.
 */

/** The calls the rotation makes: `client`'s in the page, a fake server in the tests. */
export interface RotationApi {
  /** `GET /api/vault`. */
  vault(): Promise<ServerVault>;
  /** `GET /api/vault/items?cursor=`, `null` for the first page. */
  items(cursor: string | null): Promise<VaultItems>;
  /** `POST /api/vault/rotations`, with the `seq` of `vault()`. */
  rotate(body: VaultRotation): Promise<void>;
}

/**
 * - `rotated`: the new version is the server's, and this Appareil holds it;
 * - `not-pending`: nothing to rotate (any more: another holder did it);
 * - `unknown-holder`: a holder this Appareil cannot seal for (or itself not listed): the Runner rotates;
 * - `locked`: this Appareil holds no vault key;
 * - `failed`: refused twice, or an item key that does not open.
 */
export type RotationOutcome = 'rotated' | 'not-pending' | 'unknown-holder' | 'locked' | 'failed';

export interface VaultRotationOptions {
  readonly devices: Pick<DeviceStore, 'getDevice'>;
  readonly vault: Pick<Vault, 'state' | 'version' | 'unlockVault' | 'rawVaultKeyForWrap'>;
  readonly api: RotationApi;
}

export interface VaultRotationKeys {
  /** Rotates once, and once more after a refusal that a reload can fix (409, 422, an item sealed again). Never throws. */
  rotate(): Promise<RotationOutcome>;
}

/** What a reload of the vault can fix: another change won the race, or the lists (or an item's key) moved meanwhile. */
const RETRIED: ReadonlySet<string> = new Set(['vault.version-changed', 'realtime.stale', 'vault.holders-missing', 'vault.items-missing', 'vault.items-changed']);

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

/** The key this Appareil authenticated for `holder`, `null` when none. */
const authenticated = (device: StoredDevice & { deviceId: string }, holder: ServerVault['holders'][number]): Bytes | null => {
  const listed = fromBase64Url(holder.publicKey);
  if (holder.type === 'device') return holder.id === device.deviceId && constantTimeEqual(listed, device.publicKey) ? device.publicKey : null;
  return device.runnerPublicKey && constantTimeEqual(listed, device.runnerPublicKey) ? device.runnerPublicKey : null;
};

class Stop extends Error {
  constructor(readonly outcome: RotationOutcome) {
    super(outcome);
  }
}

export const createVaultRotation = ({ devices, vault, api }: VaultRotationOptions): VaultRotationKeys => {
  /** Every item key of the server's, rewrapped from `oldKey` to `newKey`, page by page. */
  const rewrapItems = async (oldKey: CryptoKey, newKey: CryptoKey): Promise<RotatedItem[]> => {
    const items: RotatedItem[] = [];
    let cursor: string | null = null;
    do {
      const page: VaultItems = await api.items(cursor);
      for (const { itemType, itemId, aad, wrappedKey } of page.items) {
        const additional = itemKeyAad(utf8(aad));
        let raw: Bytes;
        try {
          raw = await aesGcmOpen(oldKey, fromBase64Url(wrappedKey), additional);
        } catch {
          throw new Stop('failed');
        }
        try {
          // The key read goes back as `previousKey`: the server replaces it only if no one sealed the item again since.
          items.push({ itemType, itemId, previousKey: wrappedKey, wrappedKey: toBase64Url(await aesGcmSeal(newKey, raw, additional)) });
        } finally {
          raw.fill(0);
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return items;
  };

  /** One attempt: the vault as the server has it now, then the rotation posted. */
  const attempt = async (): Promise<void> => {
    const device = await devices.getDevice();
    const held = vault.version();
    if (!device?.deviceId || vault.state() !== 'unlocked' || held === null) throw new Stop('locked');
    const self = { ...device, deviceId: device.deviceId };
    const current = await api.vault();
    if (!current.rotationPending) throw new Stop('not-pending');
    // The key this page holds is not the server's current one: the next unlock opens it, then the page tries again.
    if (current.version !== held) throw new Stop('failed');
    const recipients = current.holders.map((holder) => ({ holder, publicKey: authenticated(self, holder) }));
    if (!recipients.some(({ holder }) => holder.type === 'device' && holder.id === self.deviceId)) throw new Stop('unknown-holder');
    if (recipients.some(({ publicKey }) => publicKey === null)) throw new Stop('unknown-holder');

    const toVersion = current.version + 1;
    const oldRaw = await vault.rawVaultKeyForWrap();
    const oldKey = await importAesKey(oldRaw).finally(() => oldRaw.fill(0));
    const newKey = await generateAesKey({ extractable: true });
    const newRaw = await exportAesKey(newKey);
    try {
      const items = await rewrapItems(oldKey, newKey);
      const wraps: RotationWrap[] = [];
      for (const { holder, publicKey } of recipients) {
        const wrap = await sealWrap(self.privateKey, publicKey as Bytes, newRaw, INFO.vaultWrap, utf8(vaultWrapAad(holder.id, toVersion)));
        wraps.push({ holderType: holder.type, holderId: holder.id, enc: toBase64Url(wrap.enc), ciphertext: toBase64Url(wrap.ciphertext), tag: toBase64Url(wrap.tag) });
      }
      await api.rotate({ fromVersion: current.version, toVersion, wraps, items, seq: current.seq });
    } finally {
      newRaw.fill(0);
    }
  };

  return {
    async rotate() {
      for (let tries = 0; tries < 2; tries++) {
        try {
          await attempt();
          // What this page seals from now on goes under the new key; a failed unlock is the page's to retry.
          await vault.unlockVault().catch(() => undefined);
          return 'rotated';
        } catch (error) {
          if (error instanceof Stop) return error.outcome;
          if (!RETRIED.has(codeOf(error) ?? '')) return 'failed';
        }
      }
      return 'failed';
    },
  };
};
