import { createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { type BrowserPairing, type ConfirmPairing, DEVICE_PROOF_LABELS, type NewDeviceRequest, PAIRING_PROOF_LABELS, type RunnerPairing, type Wrap } from '@crewdeck/contracts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford base32 of `bytes`, as the page shows the secret in the command. */
export const base32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
};

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** An X25519 public key, raw, base64url. */
const x25519PublicKey = (): string => generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x ?? '';

/** The proof of `PAIRING_PROOF_LABELS[side]`: HMAC-SHA256(secret, label ‖ shortId ‖ own key ‖ peer's key). */
export const pairingProof = (side: keyof typeof PAIRING_PROOF_LABELS, secret: Uint8Array, shortId: string, own: string, peer: string): string =>
  b64(
    createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(PAIRING_PROOF_LABELS[side]), Buffer.from(shortId, 'ascii'), Buffer.from(own, 'base64url'), Buffer.from(peer, 'base64url')]))
      .digest(),
  );

/**
 * A wrap the server cannot tell from a real one: the same sizes (an `enc`
 * of 32 bytes, a 32-byte key sealed with its 16-byte tag, a 32-byte tag).
 * The server never opens a wrap; the browser and the Go tests open real ones
 * (apps/web/src/keys/, apps/runner/internal/keys/).
 */
export const shapedWrap = (): Wrap => ({ enc: b64(randomBytes(32)), ciphertext: b64(randomBytes(48)), tag: b64(randomBytes(32)) });

/**
 * Both ends of a link as the page and `crewdeck-runner link` compute them,
 * without the server: the secret of the command, each side's key pair and
 * proof. `vaultKey` is never sent: the tests look for it where it must not be.
 */
export const pairingSides = () => {
  const secret = new Uint8Array(randomBytes(16));
  const vaultKey = new Uint8Array(randomBytes(32));
  const devicePublicKey = x25519PublicKey();
  const runnerPublicKey = x25519PublicKey();
  const runnerVaultWrap = shapedWrap();
  const deviceVaultWrap = shapedWrap();
  return {
    secret,
    vaultKey,
    devicePublicKey,
    runnerPublicKey,
    /** What the page sends with `POST /api/runner/link-codes`. */
    browser: (deviceName = 'Chrome sur Linux'): BrowserPairing => ({ devicePublicKey, deviceName }),
    /** What the binary sends with `POST /api/runner/link/:linkId/pairing`. */
    runner: (shortId: string): RunnerPairing => ({ runnerPublicKey, proof: pairingProof('runner', secret, shortId, runnerPublicKey, devicePublicKey) }),
    /** The page's confirmation, once it checked the Runner's proof. */
    confirm: (shortId: string, vaultKeyVersion = 1, firstDevice = true): ConfirmPairing => ({
      proof: pairingProof('device', secret, shortId, devicePublicKey, runnerPublicKey),
      vaultKeyVersion,
      runnerVaultWrap,
      ...(firstDevice ? { deviceVaultWrap } : {}),
    }),
    /** The spellings of the secret and the vault key a leak could take. */
    leaks: (): string[] => [base32(secret), b64(secret), Buffer.from(secret).toString('hex'), b64(vaultKey), Buffer.from(vaultKey).toString('hex')],
  };
};

export type PairingSides = ReturnType<typeof pairingSides>;

const hmac = (secret: Uint8Array, ...parts: Buffer[]): string => b64(createHmac('sha256', secret).update(Buffer.concat(parts)).digest());

/** `proof_N`: HMAC-SHA256(secret, "crewdeck/v1/device/new" ‖ publicKey). */
export const newDeviceProof = (secret: Uint8Array, publicKey: string): string =>
  hmac(secret, Buffer.from(DEVICE_PROOF_LABELS.new), Buffer.from(publicKey, 'base64url'));

/** `proof_A`: HMAC-SHA256(secret, "crewdeck/v1/device/approve" ‖ newPublicKey ‖ approverPublicKey). */
export const approvalProof = (secret: Uint8Array, newPublicKey: string, approverPublicKey: string): string =>
  hmac(secret, Buffer.from(DEVICE_PROOF_LABELS.approve), Buffer.from(newPublicKey, 'base64url'), Buffer.from(approverPublicKey, 'base64url'));

/**
 * A new Appareil as its page computes it (E2E-3): its key pair, the secret of
 * its code (never sent) and what it registers with `POST /api/devices`.
 */
export const newDeviceSide = (name = 'Safari sur iPhone') => {
  const secret = new Uint8Array(randomBytes(16));
  const publicKey = x25519PublicKey();
  return {
    secret,
    publicKey,
    request: (): NewDeviceRequest => ({ publicKey, name, proof: newDeviceProof(secret, publicKey) }),
    /** The code the page shows: `<shortId>-<secret>`. */
    code: (shortId: string): string => `${shortId}-${base32(secret)}`,
    leaks: (): string[] => [base32(secret), b64(secret), Buffer.from(secret).toString('hex')],
  };
};
