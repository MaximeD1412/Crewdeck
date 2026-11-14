import { vaultWrapAad, type VaultKeyWrap } from '@crewdeck/contracts';
import { type Bytes, concat, fromBase64Url, utf8 } from './bytes.js';
import { INFO, aesGcmOpen, aesGcmSeal, exportAesKey, generateAesKey, importAesKey, openWrap } from './crypto.js';
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
const itemKeyAad = (aad: Uint8Array): Bytes => {
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
      const { deviceId, privateKey, publicKey, senderPublicKey } = device;
      let wrap: VaultKeyWrap;
      try {
        wrap = await fetchWrap(deviceId);
      } catch (error) {
        const code = codeOf(error);
        return set(code === 'devices.not-found' || code === 'devices.revoked' ? 'no-device' : 'locked');
      }
      // The first Appareil wrapped the key for itself; an approved one keeps its approver's key (E2E-3).
      const open = () =>
        openWrap(
          privateKey,
          senderPublicKey ?? publicKey,
          { enc: fromBase64Url(wrap.enc), ciphertext: fromBase64Url(wrap.ciphertext), tag: fromBase64Url(wrap.tag) },
          INFO.vaultWrap,
          utf8(vaultWrapAad(deviceId, wrap.vaultKeyVersion)),
        );
      let raw: Bytes;
      try {
        raw = await open();
      } catch {
        return set('locked');
      }
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
