import { createCipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, type KeyObject, randomBytes } from 'node:crypto';
import { CROCKFORD_ALPHABET, PAIRING_PROOF_LABELS, type Wrap } from '@crewdeck/contracts';

/**
 * The page's side of a link, in Node, for the scenario `smoke` only
 * (RUNNER-14): the compiled Runner checks the Appareil's proof and opens the
 * vault key's wrap, so they must be real. A port of `sealWrap` of
 * apps/web/src/keys/crypto.ts (HPKE base mode, RFC 9180, then the sender's
 * tag); docs/security/e2e.md gives the bytes. Never used outside
 * `src/testing/`: the server never seals nor opens a wrap (ADR 0003).
 */

const u16 = (n: number): Buffer => Buffer.from([n >> 8, n & 0xff]);
const utf8 = (text: string): Buffer => Buffer.from(text, 'utf8');
const KEM_SUITE = Buffer.concat([utf8('KEM'), u16(0x0020)]);
const HPKE_SUITE = Buffer.concat([utf8('HPKE'), u16(0x0020), u16(0x0001), u16(0x0002)]);
const EMPTY = Buffer.alloc(0);
const WRAP_AUTH = 'crewdeck/v1/wrap-auth';

const labeled = (suite: Buffer, label: string, bytes: Uint8Array): Buffer => Buffer.concat([utf8('HPKE-v1'), suite, utf8(label), bytes]);
const hmac = (key: Uint8Array, bytes: Uint8Array): Buffer => createHmac('sha256', key).update(bytes).digest();
const extract = (salt: Uint8Array, ikm: Uint8Array): Buffer => hmac(salt.length === 0 ? Buffer.alloc(32) : salt, ikm);
const expand = (prk: Uint8Array, info: Uint8Array, length: number): Buffer => {
  const blocks: Uint8Array[] = [];
  let previous: Uint8Array = EMPTY;
  for (let i = 1; Buffer.concat(blocks).length < length; i++) {
    previous = hmac(prk, Buffer.concat([previous, info, Buffer.from([i])]));
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
};
const labeledExtract = (suite: Buffer, salt: Uint8Array, label: string, ikm: Uint8Array): Buffer => extract(salt, labeled(suite, label, ikm));
const labeledExpand = (suite: Buffer, prk: Uint8Array, label: string, info: Uint8Array, length: number): Buffer =>
  expand(prk, Buffer.concat([u16(length), labeled(suite, label, info)]), length);

// X25519 keys as raw bytes, through Node's KeyObjects.
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');
const privateKeyOf = (raw: Uint8Array): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: 'der', type: 'pkcs8' });
const publicKeyObject = (raw: Uint8Array): KeyObject => createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: 'der', type: 'spki' });

/** The 32 raw bytes of an X25519 public key. */
export const publicKeyOf = (privateKey: Uint8Array): Buffer => Buffer.from(createPublicKey(privateKeyOf(privateKey)).export({ format: 'der', type: 'spki' })).subarray(SPKI_X25519.length);

/** A new X25519 private key, raw. */
export const generatePrivateKey = (): Buffer =>
  Buffer.from(generateKeyPairSync('x25519').privateKey.export({ format: 'der', type: 'pkcs8' })).subarray(PKCS8_X25519.length);

const x25519 = (privateKey: Uint8Array, publicKey: Uint8Array): Buffer => {
  const shared = diffieHellman({ privateKey: privateKeyOf(privateKey), publicKey: publicKeyObject(publicKey) });
  if (shared.every((byte) => byte === 0)) throw new Error('keys: low-order public key');
  return shared;
};

/**
 * Seals `plaintext` for the holder of `recipientPublicKey`, single shot,
 * sequence number 0; `ephemeral` is drawn unless a test vector gives it.
 */
export const hpkeSeal = (
  recipientPublicKey: Uint8Array,
  plaintext: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  ephemeral: Uint8Array = generatePrivateKey(),
): { enc: Buffer; ciphertext: Buffer } => {
  if (aad.length === 0) throw new Error('keys: the additional data is empty');
  const enc = publicKeyOf(ephemeral);
  const dh = x25519(ephemeral, recipientPublicKey);
  const prk = labeledExtract(KEM_SUITE, EMPTY, 'eae_prk', dh);
  const shared = labeledExpand(KEM_SUITE, prk, 'shared_secret', Buffer.concat([enc, recipientPublicKey]), 32);
  const context = Buffer.concat([
    Buffer.from([0x00]),
    labeledExtract(HPKE_SUITE, EMPTY, 'psk_id_hash', EMPTY),
    labeledExtract(HPKE_SUITE, EMPTY, 'info_hash', info),
  ]);
  const secret = labeledExtract(HPKE_SUITE, shared, 'secret', EMPTY);
  const key = labeledExpand(HPKE_SUITE, secret, 'key', context, 32);
  const nonce = labeledExpand(HPKE_SUITE, secret, 'base_nonce', context, 12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce).setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { enc, ciphertext };
};

/**
 * The sender's tag of a wrap: HMAC-SHA256(authKey, u16(len info) ‖ info ‖
 * u16(len aad) ‖ aad ‖ enc ‖ ciphertext), authKey = HKDF-SHA256(salt "",
 * X25519(skS, pkR), "crewdeck/v1/wrap-auth" ‖ pkS ‖ pkR, 32).
 */
export const wrapTag = (
  senderPrivateKey: Uint8Array,
  recipientPublicKey: Uint8Array,
  wrap: { enc: Uint8Array; ciphertext: Uint8Array },
  info: Uint8Array,
  aad: Uint8Array,
): Buffer => {
  const dh = x25519(senderPrivateKey, recipientPublicKey);
  const authKey = Buffer.from(hkdfSync('sha256', dh, EMPTY, Buffer.concat([utf8(WRAP_AUTH), publicKeyOf(senderPrivateKey), recipientPublicKey]), 32));
  return hmac(authKey, Buffer.concat([u16(info.length), info, u16(aad.length), aad, wrap.enc, wrap.ciphertext]));
};

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** A wrap of `plaintext` for `recipientPublicKey`, tagged by `senderPrivateKey`'s holder, in its wire form. */
export const sealWrap = (senderPrivateKey: Uint8Array, recipientPublicKey: Uint8Array, plaintext: Uint8Array, info: string, aad: string): Wrap => {
  const sealed = hpkeSeal(recipientPublicKey, plaintext, utf8(info), utf8(aad));
  return { enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext), tag: b64(wrapTag(senderPrivateKey, recipientPublicKey, sealed, utf8(info), utf8(aad))) };
};

/** The device's proof: HMAC-SHA256(secret, label ‖ shortId ‖ own key ‖ peer's key), base64url. */
export const deviceProof = (secret: Uint8Array, shortId: string, devicePublicKey: Uint8Array, runnerPublicKey: Uint8Array): string =>
  b64(hmac(secret, Buffer.concat([utf8(PAIRING_PROOF_LABELS.device), Buffer.from(shortId, 'ascii'), devicePublicKey, runnerPublicKey])));

/** A new vault key: 32 random bytes. */
export const newVaultKey = (): Buffer => randomBytes(32);

/** Crockford base32 of `bytes`, as the page writes the secret in the command. */
export const base32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  return out;
};
