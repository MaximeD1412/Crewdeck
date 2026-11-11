import {
  DEVICE_NAME_MAX_LENGTH,
  PAIRING_PROOF_LABELS,
  vaultWrapAad,
  type BrowserPairing,
  type ConfirmPairing,
  type RunnerPairing,
  type Wrap,
} from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { decodeBase32 } from './base32.js';
import { type Bytes, concat, fromBase64Url, toBase64Url, utf8 } from './bytes.js';
import { INFO, constantTimeEqual, generateKeyPair, hmacSha256, publicKeyOf, sealWrap, type Wrap as SealedWrap } from './crypto.js';
import type { DeviceStore, StoredDevice } from './device-store.js';
import { entropy } from './entropy.js';
import type { Vault } from './vault.js';

type Browser = 'edge' | 'chrome' | 'firefox' | 'safari' | 'other';
type System = 'windows' | 'android' | 'ios' | 'macos' | 'linux' | 'other';

const browserOf = (ua: string): Browser =>
  /Edg\//.test(ua) ? 'edge' : /Firefox\/|FxiOS/.test(ua) ? 'firefox' : /Chrome\/|CriOS/.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';

const systemOf = (ua: string): System =>
  /Windows/.test(ua)
    ? 'windows'
    : /Android/.test(ua)
      ? 'android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'ios'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'macos'
          : /Linux|X11|CrOS/.test(ua)
            ? 'linux'
            : 'other';

/** The Appareil's name from the user agent: « Chrome sur Windows ». */
export const deviceNameOf = (userAgent: string): string =>
  t('keys.deviceName', {
    browser: t(`keys.deviceName.browser.${browserOf(userAgent)}`),
    system: t(`keys.deviceName.system.${systemOf(userAgent)}`),
  }).slice(0, DEVICE_NAME_MAX_LENGTH);

/** `HMAC-SHA256(secret, label ‖ shortId ‖ own public key ‖ peer's public key)`. */
export const pairingProof = (label: string, secret: Uint8Array, shortId: string, own: Uint8Array, peer: Uint8Array): Promise<Bytes> =>
  hmacSha256(secret, concat(utf8(label), utf8(shortId), own, peer));

/** The link code's `pending` state the page answers. */
export interface PendingLink {
  /** The secret of the code, in base32, that never left the page. */
  readonly secret: string;
  readonly shortId: string;
  /** The Runner's id, drawn once it took the code: its wrap's additional data. */
  readonly runnerId: string;
  readonly runnerPairing: RunnerPairing;
}

export interface LinkKeys {
  /** The pairing sent with a new code: this browser's Appareil, drawn and kept the first time. */
  browserPairing(): Promise<BrowserPairing>;
  /** The id the server gave the Appareil with the code. */
  adoptDevice(deviceId: string): Promise<void>;
  /**
   * The page's answer to the Runner's pairing, or `null` when its proof does
   * not match the keys the server relayed (the page then rejects the code).
   * The first time, a new vault key wrapped for the Runner and for this
   * Appareil; from an unlocked vault, the same key for the Runner only.
   */
  confirmPairing(link: PendingLink): Promise<ConfirmPairing | null>;
}

export interface LinkKeysOptions {
  readonly devices: DeviceStore;
  readonly vault: Pick<Vault, 'state' | 'version' | 'rawVaultKeyForWrap'>;
  readonly userAgent: string;
  /** Called with the Appareil's id once known (the `X-Crewdeck-Device` header). */
  readonly onDevice?: (deviceId: string) => void;
}

const wireWrap = (wrap: SealedWrap): Wrap => ({ enc: toBase64Url(wrap.enc), ciphertext: toBase64Url(wrap.ciphertext), tag: toBase64Url(wrap.tag) });

export const createLinkKeys = ({ devices, vault, userAgent, onDevice }: LinkKeysOptions): LinkKeys => {
  const device = async (): Promise<StoredDevice> => {
    const stored = await devices.getDevice();
    if (stored) return stored;
    const { privateKey } = await generateKeyPair();
    const drawn = { deviceId: null, privateKey, publicKey: await publicKeyOf(privateKey) };
    await devices.saveDevice(drawn);
    return drawn;
  };

  return {
    async browserPairing() {
      const { publicKey } = await device();
      return { devicePublicKey: toBase64Url(publicKey), deviceName: deviceNameOf(userAgent) };
    },
    async adoptDevice(deviceId) {
      const stored = await device();
      if (stored.deviceId !== deviceId) await devices.saveDevice({ ...stored, deviceId });
      onDevice?.(deviceId);
    },
    async confirmPairing({ secret: encoded, shortId, runnerId, runnerPairing }) {
      const { deviceId, privateKey, publicKey } = await device();
      if (!deviceId) throw new Error('keys: the Appareil has no id yet');
      const secret = decodeBase32(encoded);
      const runnerPublicKey = fromBase64Url(runnerPairing.runnerPublicKey);
      const expected = await pairingProof(PAIRING_PROOF_LABELS.runner, secret, shortId, runnerPublicKey, publicKey);
      if (!constantTimeEqual(expected, fromBase64Url(runnerPairing.proof))) return null;

      const held = vault.state() === 'unlocked' ? vault.version() : null;
      const version = held ?? 1;
      const vaultKey = held ? await vault.rawVaultKeyForWrap() : await entropy().bytes(32);
      try {
        const seal = (recipient: Uint8Array, holderId: string) =>
          sealWrap(privateKey, recipient, vaultKey, INFO.vaultWrap, utf8(vaultWrapAad(holderId, version)));
        const runnerVaultWrap = wireWrap(await seal(runnerPublicKey, runnerId));
        const deviceVaultWrap = held ? undefined : wireWrap(await seal(publicKey, deviceId));
        const proof = await pairingProof(PAIRING_PROOF_LABELS.device, secret, shortId, publicKey, runnerPublicKey);
        return {
          proof: toBase64Url(proof),
          vaultKeyVersion: version,
          runnerVaultWrap,
          ...(deviceVaultWrap ? { deviceVaultWrap } : {}),
        };
      } finally {
        vaultKey.fill(0);
        secret.fill(0);
      }
    },
  };
};
