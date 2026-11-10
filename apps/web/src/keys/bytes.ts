/** Byte strings: how they travel in JSON (base64url without padding), UTF-8. */

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export const utf8 = (text: string): Bytes => encoder.encode(text);

export const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** A copy WebCrypto accepts whatever buffer the input views. */
export const own = (bytes: Uint8Array): Bytes => new Uint8Array(bytes);

export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

/** Strict: only the base64url alphabet, no padding, a single spelling per byte string. */
export const fromBase64Url = (text: string): Bytes => {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new Error('not a base64url string without padding');
  }
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (toBase64Url(bytes) !== text) throw new Error('not a canonical base64url string');
  return bytes;
};
