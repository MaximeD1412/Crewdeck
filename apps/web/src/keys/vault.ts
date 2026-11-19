import { vaultWrapAad, type VaultKeyWrap } from '@crewdeck/contracts';
import { type Bytes, concat, fromBase64Url, utf8 } from './bytes.js';
import { INFO, aesGcmOpen, aesGcmSeal, constantTimeEqual as sameBytes, exportAesKey, generateAesKey, importAesKey, openWrap } from './crypto.js';
import type { DeviceStore } from './device-store.js';

/**
 * Where this browser stands with the Pilote's vault key: `unlocked` once its
 * Appareil opened its wrap, `locked` while it cannot (an Appareil not trusted
 * yet, the server out of reach), `no-device` when this browser has no
 * Appareil the server knows (E2E-3 approves one).
 */
export type VaultState = 'locked' | 'unlocked' | 'no-device';

/** An item under the vault key: its own key sealed by the vault key, its content sealed by that key. */
export interface SealedItem {
  readonly key: Bytes;
  readonly ciphertext: Bytes;
}

export interface VaultOptions {
  readonly devices: DeviceStore;
  /** `GET /api/devices/:id/vault-key-wrap`; a refusal carries the envelope's `code`. */
  readonly fetchWrap: (deviceId: string) => Promise<VaultKeyWrap>;
  /** Called with each new state (the store's `vaultState`). */
  readonly onState?: (state: VaultState) => void;
}

export interface Vault {
  readonly state: () => VaultState;
  /** The version of the vault key held, `null` until unlocked. */
  readonly version: () => number | null;
  /**
   * Fetches this Appareil's wrap, opens it with its non-extractable private
   * key, and keeps the vault key in memory as a non-extractable AES-GCM key.
   */
  unlockVault(): Promise<VaultState>;
  sealItem(plaintext: Uint8Array, aad: Uint8Array): Promise<SealedItem>;
  openItem(item: SealedItem, aad: Uint8Array): Promise<Bytes>;
  /**
   * The vault key's bytes, opened again from the wrap, only to wrap the key
   * for a new holder: the caller seals them and overwrites them at once.
   */
  rawVaultKeyForWrap(): Promise<Bytes>;
}

/** An item key under the vault key is sealed under this label ‖ the item's additional data: it never opens as an item. */
const ITEM_KEY_AAD = utf8('crewdeck/v1/item-key');
/** The additional data of an item key under the vault key: the label ‖ the item's own (the rotation's too, E2E-4). */
export const itemKeyAad = (aad: Uint8Array): Bytes => {
  // The item's own additional data binds it to its place (an Idée's id and field), as the Runner's.
  if (aad.length === 0) throw new Error('keys: the additional data is empty');
  return concat(ITEM_KEY_AAD, aad);
};

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

interface Held {
  readonly key: CryptoKey;
  readonly version: number;
  /** What `rawVaultKeyForWrap` opens again. */
  readonly open: () => Promise<Bytes>;
}

export const createVault = ({ devices, fetchWrap, onState }: VaultOptions): Vault => {
  let state: VaultState = 'locked';
  let held: Held | null = null;

  const set = (next: VaultState): VaultState => {
    if (next !== 'unlocked') held = null;
    state = next;
    onState?.(next);
    return next;
  };

  const unlocked = (): Held => {
    if (!held) throw new Error('keys: the vault is locked');
    return held;
  };

  return {
    state: () => state,
    version: () => held?.version ?? null,
    async unlockVault() {
      const device = await devices.getDevice();
      if (!device?.deviceId) return set('no-device');
      const { deviceId, privateKey, publicKey, senderPublicKey, runnerPublicKey } = device;
      let wrap: VaultKeyWrap;
      try {
        wrap = await fetchWrap(deviceId);
      } catch (error) {
        const code = codeOf(error);
        return set(code === 'devices.not-found' || code === 'devices.revoked' ? 'no-device' : 'locked');
      }
      // The keys this Appareil authenticated, the likeliest sender first: the
      // first Appareil sealed its own wrap, an approved one holds its
      // approver's (E2E-3), and after a rotation (E2E-4) the rotating holder
      // was this Appareil itself or the Runner.
      const senders = [senderPublicKey ?? publicKey, publicKey, runnerPublicKey].filter(
        (key, index, keys): key is Bytes => key !== undefined && keys.findIndex((other) => other !== undefined && sameBytes(other, key)) === index,
      );
      const sealed = { enc: fromBase64Url(wrap.enc), ciphertext: fromBase64Url(wrap.ciphertext), tag: fromBase64Url(wrap.tag) };
      const aad = utf8(vaultWrapAad(deviceId, wrap.vaultKeyVersion));
      let raw: Bytes | null = null;
      let sender: Bytes | null = null;
      for (const candidate of senders) {
        try {
          raw = await openWrap(privateKey, candidate, sealed, INFO.vaultWrap, aad);
          sender = candidate;
          break;
        } catch {
          // Not this sender's: the next one.
        }
      }
      if (!raw || !sender) return set('locked');
      const from = sender;
      const open = () => openWrap(privateKey, from, sealed, INFO.vaultWrap, aad);
      const key = await importAesKey(raw);
      raw.fill(0);
      held = { key, version: wrap.vaultKeyVersion, open };
      return set('unlocked');
    },
    async sealItem(plaintext, aad) {
      const { key: vaultKey } = unlocked();
      const itemKey = await generateAesKey({ extractable: true });
      const raw = await exportAesKey(itemKey);
      try {
        const key = await aesGcmSeal(vaultKey, raw, itemKeyAad(aad));
        return { key, ciphertext: await aesGcmSeal(itemKey, plaintext, aad) };
      } finally {
        raw.fill(0);
      }
    },
    async openItem(item, aad) {
      const { key: vaultKey } = unlocked();
      const raw = await aesGcmOpen(vaultKey, item.key, itemKeyAad(aad));
      const itemKey = await importAesKey(raw);
      raw.fill(0);
      return aesGcmOpen(itemKey, item.ciphertext, aad);
    },
    rawVaultKeyForWrap: () => unlocked().open(),
  };
};
