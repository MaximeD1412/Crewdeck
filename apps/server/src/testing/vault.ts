/**
 * Test only: an Appareil's side of the vault (docs/security/e2e.md), in
 * node:crypto, for the scenarios that seed sealed texts. A scenario's
 * Appareil wraps the vault key for itself and seals its Idées as the page
 * would; the page, given the same private key, opens them. Never imported
 * outside `src/testing/`; `vault.spec.ts` checks it against the Runner's
 * vectors (`packages/contracts/fixtures/crypto/item.json`).
 */
import { createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto';

const utf8 = (text: string): Buffer => Buffer.from(text, 'utf8');
const u16 = (n: number): Buffer => Buffer.from([n >> 8, n & 0xff]);
const concat = (...parts: Uint8Array[]): Buffer => Buffer.concat(parts);

// PKCS #8 and SPKI of an X25519 key (RFC 8410): this prefix, then the 32 bytes.
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

const privateKeyOf = (raw: Uint8Array): KeyObject => createPrivateKey({ key: concat(PKCS8_X25519, raw), format: 'der', type: 'pkcs8' });
const publicKeyObject = (raw: Uint8Array): KeyObject => createPublicKey({ key: concat(SPKI_X25519, raw), format: 'der', type: 'spki' });
const rawPublicKey = (privateKey: KeyObject): Buffer => (createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI_X25519.length);
const x25519 = (privateKey: Uint8Array, publicKey: Uint8Array): Buffer =>
  diffieHellman({ privateKey: privateKeyOf(privateKey), publicKey: publicKeyObject(publicKey) });

/** The raw X25519 public key of raw private bytes. */
export const publicKeyFor = (privateKey: Uint8Array): Buffer => rawPublicKey(privateKeyOf(privateKey));

// HPKE base mode (RFC 9180): DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM.
const KEM_SUITE = concat(utf8('KEM'), u16(0x0020));
const HPKE_SUITE = concat(utf8('HPKE'), u16(0x0020), u16(0x0001), u16(0x0002));
const labeled = (suite: Buffer, label: string, bytes: Uint8Array): Buffer => concat(utf8('HPKE-v1'), suite, utf8(label), bytes);
const EMPTY = Buffer.alloc(0);
const hmac = (key: Uint8Array, message: Uint8Array): Buffer => createHmac('sha256', key).update(message).digest();
const labeledExtract = (suite: Buffer, label: string, ikm: Uint8Array): Buffer => hmac(Buffer.alloc(32), labeled(suite, label, ikm));
const labeledHkdf = (suite: Buffer, salt: Uint8Array, extractLabel: string, ikm: Uint8Array, expandLabel: string, info: Uint8Array, length: number): Buffer =>
  Buffer.from(hkdfSync('sha256', labeled(suite, extractLabel, ikm), salt, concat(u16(length), labeled(suite, expandLabel, info)), length));

const keySchedule = (dh: Buffer, enc: Uint8Array, recipientPublicKey: Uint8Array, info: Uint8Array) => {
  const shared = labeledHkdf(KEM_SUITE, EMPTY, 'eae_prk', dh, 'shared_secret', concat(enc, recipientPublicKey), 32);
  const context = concat(Buffer.from([0]), labeledExtract(HPKE_SUITE, 'psk_id_hash', EMPTY), labeledExtract(HPKE_SUITE, 'info_hash', info));
  return {
    key: labeledHkdf(HPKE_SUITE, shared, 'secret', EMPTY, 'key', context, 32),
    nonce: labeledHkdf(HPKE_SUITE, shared, 'secret', EMPTY, 'base_nonce', context, 12),
  };
};

const gcmSeal = (key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Buffer => {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  return concat(cipher.update(plaintext), cipher.final(), cipher.getAuthTag());
};

const gcmOpen = (key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Buffer => {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return concat(decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final());
};

export interface Wrap {
  readonly enc: Buffer;
  readonly ciphertext: Buffer;
  readonly tag: Buffer;
}

const WRAP_AUTH = 'crewdeck/v1/wrap-auth';

const wrapTag = (dh: Buffer, senderPublicKey: Uint8Array, recipientPublicKey: Uint8Array, wrap: { enc: Uint8Array; ciphertext: Uint8Array }, info: Uint8Array, aad: Uint8Array): Buffer => {
  const authKey = Buffer.from(hkdfSync('sha256', dh, EMPTY, concat(utf8(WRAP_AUTH), senderPublicKey, recipientPublicKey), 32));
  return hmac(authKey, concat(u16(info.length), info, u16(aad.length), aad, wrap.enc, wrap.ciphertext));
};

/** An authenticated wrap of `plaintext` for `recipientPublicKey`, sealed by the holder of `senderPrivateKey` (raw bytes). */
export const sealWrap = (senderPrivateKey: Uint8Array, recipientPublicKey: Uint8Array, plaintext: Uint8Array, info: string, aad: string): Wrap => {
  const ephemeral = randomBytes(32);
  const enc = publicKeyFor(ephemeral);
  const { key, nonce } = keySchedule(x25519(ephemeral, recipientPublicKey), enc, recipientPublicKey, utf8(info));
  const ciphertext = gcmSeal(key, nonce, plaintext, utf8(aad));
  const tag = wrapTag(x25519(senderPrivateKey, recipientPublicKey), publicKeyFor(senderPrivateKey), recipientPublicKey, { enc, ciphertext }, utf8(info), utf8(aad));
  return { enc, ciphertext, tag };
};

/** Opens a wrap the holder of `senderPublicKey` sealed for the holder of `recipientPrivateKey`; throws on any mismatch. */
export const openWrap = (recipientPrivateKey: Uint8Array, senderPublicKey: Uint8Array, wrap: Wrap, info: string, aad: string): Buffer => {
  const recipientPublicKey = publicKeyFor(recipientPrivateKey);
  const tag = wrapTag(x25519(recipientPrivateKey, senderPublicKey), senderPublicKey, recipientPublicKey, wrap, utf8(info), utf8(aad));
  if (tag.length !== wrap.tag.length || !timingSafeEqual(tag, wrap.tag)) throw new Error('vault: the wrap’s tag does not match');
  const { key, nonce } = keySchedule(x25519(recipientPrivateKey, wrap.enc), wrap.enc, recipientPublicKey, utf8(info));
  return gcmOpen(key, nonce, wrap.ciphertext, utf8(aad));
};

// AES-256-GCM: nonce (12 bytes) ‖ ciphertext ‖ tag (16 bytes).
const aesSeal = (key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Buffer => {
  const nonce = randomBytes(12);
  return concat(nonce, gcmSeal(key, nonce, plaintext, aad));
};
const aesOpen = (key: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Buffer => gcmOpen(key, sealed.subarray(0, 12), sealed.subarray(12), aad);

const ITEM_KEY_AAD = 'crewdeck/v1/item-key';

/** An item under the vault key, its fields base64url: its own key sealed by the vault key, its content by that key. */
export interface SealedItem {
  readonly key: string;
  readonly ciphertext: string;
}

/** Seals `plaintext` under the vault key, bound to `aad` (an Idée's `"<id>:text"`), as the page's `Vault.sealItem`. */
export const sealItem = (vaultKey: Uint8Array, plaintext: string, aad: string): SealedItem => {
  const itemKey = randomBytes(32);
  return {
    key: aesSeal(vaultKey, itemKey, concat(utf8(ITEM_KEY_AAD), utf8(aad))).toString('base64url'),
    ciphertext: aesSeal(itemKey, utf8(plaintext), utf8(aad)).toString('base64url'),
  };
};

/** Opens what `sealItem` (or the page, or the Runner) sealed. */
export const openItem = (vaultKey: Uint8Array, item: SealedItem, aad: string): Buffer => {
  const itemKey = aesOpen(vaultKey, Buffer.from(item.key, 'base64url'), concat(utf8(ITEM_KEY_AAD), utf8(aad)));
  return aesOpen(itemKey, Buffer.from(item.ciphertext, 'base64url'), utf8(aad));
};

/** A frame or an input of a Session's relay, its fields base64url: its 12-byte nonce, its AES-256-GCM ciphertext and tag. */
export interface SealedFrame {
  readonly nonce: string;
  readonly ciphertext: string;
}

/** Seals `plaintext` under a Session's key, bound to `aad` (a frame's `"<sessionId>:<seq>"`), as the Runner's relay. */
export const sealFrame = (sessionKey: Uint8Array, plaintext: string, aad: string): SealedFrame => {
  const nonce = randomBytes(12);
  return { nonce: nonce.toString('base64url'), ciphertext: gcmSeal(sessionKey, nonce, utf8(plaintext), utf8(aad)).toString('base64url') };
};

/** Opens what `sealFrame` (or the page's input, `"<sessionId>:input:<inputId>"`) sealed; throws on any mismatch. */
export const openFrame = (sessionKey: Uint8Array, frame: SealedFrame, aad: string): Buffer =>
  gcmOpen(sessionKey, Buffer.from(frame.nonce, 'base64url'), Buffer.from(frame.ciphertext, 'base64url'), utf8(aad));
