import {
  type ApproveDevice,
  DEVICE_CODE_PREFIX,
  DEVICE_PROOF_LABELS,
  type Device,
  type DeviceApproval,
  type DeviceCreated,
  LINK_CODE_SECRET_LENGTH,
  type NewDeviceRequest,
  type PendingDevice,
  vaultWrapAad,
  zShortId,
} from '@crewdeck/contracts';
import { decodeBase32, encodeBase32 } from './base32.js';
import { type Bytes, concat, fromBase64Url, toBase64Url, utf8 } from './bytes.js';
import { INFO, constantTimeEqual, generateKeyPair, hmacSha256, publicKeyOf, sealWrap } from './crypto.js';
import type { DeviceStore, StoredDevice } from './device-store.js';
import { entropy } from './entropy.js';
import { deviceNameOf } from './pairing.js';
import type { Vault } from './vault.js';

/**
 * A new Appareil approved by its code (ADR 0003, E2E-3, `docs/security/e2e.md`
 * « New Appareil »). The new page draws a secret of 128 bits that never
 * leaves it and shows it in its code `<shortId>-<secret>`; the approver
 * types or scans the code, so both share the secret and the server does not:
 *
 * - `proof_N = HMAC(secret, "crewdeck/v1/device/new" ‖ newPublicKey)` tells
 *   the approver the key the server relayed is the new page's;
 * - `proof_A = HMAC(secret, "crewdeck/v1/device/approve" ‖ newPublicKey ‖
 *   approverPublicKey)` tells the new page the key its wrap was sealed with
 *   is the approver's.
 *
 * A server that swaps either key cannot forge the proof: nothing is approved,
 * nothing is opened.
 */

/** A code as typed or scanned: its short id and its secret in base32. */
export interface DeviceCode {
  readonly shortId: string;
  readonly secret: string;
}

/** The code's text, `<shortId>-<secret>`. */
export const deviceCodeText = ({ shortId, secret }: DeviceCode): string => `${shortId}-${secret}`;

/** What the QR code holds: `crewdeck:appareil:<shortId>-<secret>`. */
export const deviceCodeUri = (code: DeviceCode): string => `${DEVICE_CODE_PREFIX}${deviceCodeText(code)}`;

/** A code from what the Pilote pasted or scanned (its QR's prefix, spaces and case aside); `null` when it is none. */
export const parseDeviceCode = (text: string): DeviceCode | null => {
  let rest = text.trim();
  if (rest.toLowerCase().startsWith(DEVICE_CODE_PREFIX)) rest = rest.slice(DEVICE_CODE_PREFIX.length);
  const match = /^([0-9A-Za-z]{4})-([0-9A-Za-z]+)$/.exec(rest.replace(/\s+/g, ''));
  if (!match) return null;
  const [, shortId = '', secret = ''] = match;
  const code = { shortId: shortId.toUpperCase(), secret: secret.toUpperCase() };
  if (!zShortId.safeParse(code.shortId).success || code.secret.length !== LINK_CODE_SECRET_LENGTH) return null;
  try {
    decodeBase32(code.secret).fill(0);
  } catch {
    return null;
  }
  return code;
};

/** `proof_N`, the new page's. */
export const newDeviceProof = (secret: Uint8Array, newPublicKey: Uint8Array): Promise<Bytes> => hmacSha256(secret, concat(utf8(DEVICE_PROOF_LABELS.new), newPublicKey));

/** `proof_A`, the approver's. */
export const approveDeviceProof = (secret: Uint8Array, newPublicKey: Uint8Array, approverPublicKey: Uint8Array): Promise<Bytes> =>
  hmacSha256(secret, concat(utf8(DEVICE_PROOF_LABELS.approve), newPublicKey, approverPublicKey));

/** The calls the approval makes, `client`'s in the page, a fake server in the tests. */
export interface ApprovalApi {
  register(request: NewDeviceRequest): Promise<DeviceCreated>;
  approval(id: string): Promise<DeviceApproval>;
  pending(shortId: string): Promise<PendingDevice>;
  approve(id: string, body: ApproveDevice): Promise<Device>;
}

/** The new page's code, live until `expiresAt`. */
export interface NewDeviceCode extends DeviceCode {
  readonly id: string;
  readonly expiresAt: string;
}

/** A pending Appareil whose public key the code proved. */
export interface CheckedDevice {
  readonly code: DeviceCode;
  readonly device: PendingDevice;
}

export interface DeviceApprovalKeys {
  /** The new page: a key pair (kept while it has no id) and a new code, registered pending. */
  register(): Promise<NewDeviceCode>;
  /**
   * The new page, once its Appareil is `trusted`: checks who approved it with
   * the code's secret and keeps the approver's key as its wrap's sender
   * (then the vault opens). `invalid` saves nothing.
   */
  adopt(code: NewDeviceCode): Promise<'approved' | 'invalid'>;
  /** The approver: the pending Appareil of the code, `mismatch` when its public key is not the one the code proves. */
  check(code: DeviceCode): Promise<CheckedDevice | 'mismatch'>;
  /** The approver, once the Pilote agreed: the vault key wrapped for the checked Appareil, and `proof_A`. */
  approve(checked: CheckedDevice): Promise<Device>;
}

export interface DeviceApprovalOptions {
  readonly devices: DeviceStore;
  readonly vault: Pick<Vault, 'state' | 'version' | 'rawVaultKeyForWrap'>;
  readonly api: ApprovalApi;
  readonly userAgent: string;
  /** Called with the Appareil's id once approved (the `X-Crewdeck-Device` header). */
  readonly onDevice?: (deviceId: string) => void;
}

export const createDeviceApproval = ({ devices, vault, api, userAgent, onDevice }: DeviceApprovalOptions): DeviceApprovalKeys => {
  /** The key pair of an Appareil not approved yet: the stored one while it has no id, else a new one. */
  const unnamed = async (): Promise<StoredDevice> => {
    const stored = await devices.getDevice();
    if (stored && !stored.deviceId) return stored;
    const { privateKey } = await generateKeyPair();
    const drawn = { deviceId: null, privateKey, publicKey: await publicKeyOf(privateKey) };
    await devices.saveDevice(drawn);
    return drawn;
  };

  return {
    async register() {
      const { publicKey } = await unnamed();
      const secret = await entropy().bytes(16);
      try {
        const proof = await newDeviceProof(secret, publicKey);
        const created = await api.register({ publicKey: toBase64Url(publicKey), name: deviceNameOf(userAgent), proof: toBase64Url(proof) });
        return { id: created.id, shortId: created.shortId, expiresAt: created.expiresAt, secret: encodeBase32(secret) };
      } finally {
        secret.fill(0);
      }
    },

    async adopt(code) {
      const stored = await devices.getDevice();
      // Another tab of this browser adopted it first.
      if (stored?.deviceId === code.id) return 'approved';
      if (!stored || stored.deviceId) return 'invalid';
      const approval = await api.approval(code.id);
      const approverPublicKey = fromBase64Url(approval.approver.publicKey);
      const secret = decodeBase32(code.secret);
      try {
        const expected = await approveDeviceProof(secret, stored.publicKey, approverPublicKey);
        if (!constantTimeEqual(expected, fromBase64Url(approval.proof))) return 'invalid';
      } finally {
        secret.fill(0);
      }
      await devices.saveDevice({ ...stored, deviceId: code.id, senderPublicKey: approverPublicKey });
      onDevice?.(code.id);
      return 'approved';
    },

    async check(code) {
      const device = await api.pending(code.shortId);
      const secret = decodeBase32(code.secret);
      try {
        const expected = await newDeviceProof(secret, fromBase64Url(device.publicKey));
        return constantTimeEqual(expected, fromBase64Url(device.proof)) ? { code, device } : 'mismatch';
      } finally {
        secret.fill(0);
      }
    },

    async approve({ code, device }) {
      const self = await devices.getDevice();
      const version = vault.version();
      if (!self?.deviceId || vault.state() !== 'unlocked' || version === null) throw new Error('keys: this Appareil holds no vault key');
      const newPublicKey = fromBase64Url(device.publicKey);
      const secret = decodeBase32(code.secret);
      const vaultKey = await vault.rawVaultKeyForWrap();
      try {
        const wrap = await sealWrap(self.privateKey, newPublicKey, vaultKey, INFO.vaultWrap, utf8(vaultWrapAad(device.id, version)));
        const proof = await approveDeviceProof(secret, newPublicKey, self.publicKey);
        return await api.approve(device.id, {
          approver: { type: 'device', id: self.deviceId },
          vaultKeyVersion: version,
          wrap: { enc: toBase64Url(wrap.enc), ciphertext: toBase64Url(wrap.ciphertext), tag: toBase64Url(wrap.tag) },
          proof: toBase64Url(proof),
        });
      } finally {
        vaultKey.fill(0);
        secret.fill(0);
      }
    },
  };
};
