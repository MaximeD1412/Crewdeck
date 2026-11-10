/**
 * The end-to-end primitives an Appareil shares with the Runner (ADR 0003):
 * X25519 key pairs, the HPKE wrap, AES-256-GCM, HMAC proofs. WebCrypto only;
 * the Runner's side is apps/runner/internal/keys/, and docs/security/e2e.md
 * gives the exact bytes.
 */
import { type Bytes, concat, own, utf8 } from './bytes.js';
import { entropy } from './entropy.js';

const subtle = () => crypto.subtle;

/** The info strings of the HPKE wraps, one per use. */
export const INFO = {
  vaultWrap: 'crewdeck/v1/vault-wrap',
  itemKey: 'crewdeck/v1/item-key',
  sessionKey: 'crewdeck/v1/session-key',
} as const;
export type WrapInfo = (typeof INFO)[keyof typeof INFO];

/**
 * The only error a failed open throws: a wrong key, a tampered ciphertext and
 * a wrong additional data are not told apart.
 */
export class OpenError extends Error {
  constructor() {
    super('keys: cannot open the ciphertext');
    this.name = 'OpenError';
  }
}

/** The additional data always binds the ids the ciphertext belongs to. */
const requireAad = (aad: Uint8Array): void => {
  if (aad.length === 0) throw new Error('keys: the additional data is empty');
};

// Key holders.

/** A key holder's X25519 key pair; the private key is non-extractable. */
export const generateKeyPair = (): Promise<CryptoKeyPair> => entropy().x25519();

/** The 32-byte raw public key. */
export const exportPublicKey = async (key: CryptoKey): Promise<Bytes> =>
  new Uint8Array(await subtle().exportKey('raw', key));

const importPublicKey = (raw: Uint8Array): Promise<CryptoKey> =>
  subtle().importKey('raw', own(raw), { name: 'X25519' }, true, []);

const BASE_POINT = new Uint8Array(32).fill(9, 0, 1);

const x25519 = async (privateKey: CryptoKey, publicKey: CryptoKey): Promise<Bytes> => {
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256));
  // RFC 9180, 7.1.4: a low-order point gives all zeros; WebCrypto already refuses it.
  if (shared.every((byte) => byte === 0)) throw new Error('keys: low-order public key');
  return shared;
};

/** The raw public key of a private key, even non-extractable: X25519(sk, 9). */
export const publicKeyOf = async (privateKey: CryptoKey): Promise<Bytes> =>
  x25519(privateKey, await importPublicKey(BASE_POINT));

// HPKE base mode (RFC 9180), single shot: DHKEM(X25519, HKDF-SHA256),
// HKDF-SHA256, AES-256-GCM, one ephemeral key per seal, sequence number 0.

const u16 = (n: number): Bytes => new Uint8Array([n >> 8, n & 0xff]);
const KEM_SUITE = concat(utf8('KEM'), u16(0x0020));
const HPKE_SUITE = concat(utf8('HPKE'), u16(0x0020), u16(0x0001), u16(0x0002));
const labeled = (suite: Bytes, label: string, bytes: Uint8Array): Bytes => concat(utf8('HPKE-v1'), suite, utf8(label), bytes);
const EMPTY = new Uint8Array(0);

/** LabeledExtract alone. HMAC pads its key with zeros, so an empty salt is 32 zero bytes. */
const labeledExtract = (suite: Bytes, label: string, ikm: Uint8Array): Promise<Bytes> =>
  hmacSha256(new Uint8Array(32), labeled(suite, label, ikm));

/** LabeledExtract then LabeledExpand: one WebCrypto HKDF. */
const labeledHkdf = async (
  suite: Bytes,
  salt: Uint8Array,
  extractLabel: string,
  ikm: Uint8Array,
  expandLabel: string,
  info: Uint8Array,
  length: number,
): Promise<Bytes> => {
  const key = await subtle().importKey('raw', labeled(suite, extractLabel, ikm), 'HKDF', false, ['deriveBits']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: own(salt), info: concat(u16(length), labeled(suite, expandLabel, info)) };
  return new Uint8Array(await subtle().deriveBits(params, key, length * 8));
};

/** DHKEM's ExtractAndExpand. */
const sharedSecret = (dh: Bytes, enc: Uint8Array, recipientPublicKey: Uint8Array): Promise<Bytes> =>
  labeledHkdf(KEM_SUITE, EMPTY, 'eae_prk', dh, 'shared_secret', concat(enc, recipientPublicKey), 32);

/** The base mode's key schedule: the AES-256-GCM key and the nonce of sequence number 0. */
const keySchedule = async (shared: Bytes, info: Uint8Array): Promise<{ key: CryptoKey; nonce: Bytes }> => {
  const context = concat(
    new Uint8Array([0x00]),
    await labeledExtract(HPKE_SUITE, 'psk_id_hash', EMPTY),
    await labeledExtract(HPKE_SUITE, 'info_hash', info),
  );
  const rawKey = await labeledHkdf(HPKE_SUITE, shared, 'secret', EMPTY, 'key', context, 32);
  const nonce = await labeledHkdf(HPKE_SUITE, shared, 'secret', EMPTY, 'base_nonce', context, 12);
  return { key: await subtle().importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']), nonce };
};

const infoBytes = (info: WrapInfo | Uint8Array): Uint8Array => (typeof info === 'string' ? utf8(info) : info);

/**
 * Wraps `plaintext` for the holder of `recipientPublicKey` (32 raw bytes).
 * `enc` is the ephemeral public key (32 bytes), `ciphertext` ends with the
 * 16-byte tag.
 */
export const hpkeSeal = async (
  recipientPublicKey: Uint8Array,
  plaintext: Uint8Array,
  info: WrapInfo | Uint8Array,
  aad: Uint8Array,
): Promise<{ enc: Bytes; ciphertext: Bytes }> => {
  requireAad(aad);
  const ephemeral = await entropy().x25519();
  const dh = await x25519(ephemeral.privateKey, await importPublicKey(recipientPublicKey));
  const enc = await exportPublicKey(ephemeral.publicKey);
  const { key, nonce } = await keySchedule(await sharedSecret(dh, enc, recipientPublicKey), infoBytes(info));
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv: nonce, additionalData: own(aad) }, key, own(plaintext));
  return { enc, ciphertext: new Uint8Array(ciphertext) };
};

/** Unwraps what `hpkeSeal` sealed for the holder of `recipientPrivateKey`. */
export const hpkeOpen = async (
  recipientPrivateKey: CryptoKey,
  enc: Uint8Array,
  ciphertext: Uint8Array,
  info: WrapInfo | Uint8Array,
  aad: Uint8Array,
): Promise<Bytes> => {
  requireAad(aad);
  try {
    const dh = await x25519(recipientPrivateKey, await importPublicKey(enc));
    const shared = await sharedSecret(dh, enc, await publicKeyOf(recipientPrivateKey));
    const { key, nonce } = await keySchedule(shared, infoBytes(info));
    const plaintext = await subtle().decrypt({ name: 'AES-GCM', iv: nonce, additionalData: own(aad) }, key, own(ciphertext));
    return new Uint8Array(plaintext);
  } catch {
    throw new OpenError();
  }
};

// AES-256-GCM: nonce (12 bytes) ‖ ciphertext ‖ tag (16 bytes).

/** A random AES-256 key, extractable only where it must be wrapped. */
export const generateAesKey = ({ extractable = false } = {}): Promise<CryptoKey> => entropy().aes256(extractable);

export const importAesKey = (raw: Uint8Array, { extractable = false } = {}): Promise<CryptoKey> => {
  if (raw.length !== 32) throw new Error('keys: an AES-256 key is 32 bytes');
  return subtle().importKey('raw', own(raw), 'AES-GCM', extractable, ['encrypt', 'decrypt']);
};

/** The raw bytes of an extractable AES key, to wrap it. */
export const exportAesKey = async (key: CryptoKey): Promise<Bytes> => new Uint8Array(await subtle().exportKey('raw', key));

export const aesGcmSeal = async (key: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<Bytes> => {
  requireAad(aad);
  const nonce = await entropy().bytes(12);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv: nonce, additionalData: own(aad) }, key, own(plaintext));
  return concat(nonce, new Uint8Array(ciphertext));
};

export const aesGcmOpen = async (key: CryptoKey, sealed: Uint8Array, aad: Uint8Array): Promise<Bytes> => {
  requireAad(aad);
  if (sealed.length < 12 + 16) throw new OpenError();
  try {
    const params = { name: 'AES-GCM', iv: own(sealed.subarray(0, 12)), additionalData: own(aad) };
    return new Uint8Array(await subtle().decrypt(params, key, own(sealed.subarray(12))));
  } catch {
    throw new OpenError();
  }
};

// The pairing proofs.

export const hmacSha256 = async (secret: Uint8Array, bytes: Uint8Array): Promise<Bytes> => {
  const key = await subtle().importKey('raw', own(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', key, own(bytes)));
};

/** Compares every byte whatever the first difference; the lengths are not secret. */
export const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
};
