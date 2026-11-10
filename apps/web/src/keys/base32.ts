/**
 * Crockford's base32 (https://www.crockford.com/base32.html), as the link and
 * Appareil codes use it: no padding, no check symbol, the bits read from the
 * most significant one, the last symbol padded with zero bits. The Runner's
 * twin is apps/runner/internal/keys/base32.go.
 */
import type { Bytes } from './bytes.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Each accepted character, in either case, with its value. */
const SYMBOLS = new Map<string, number>(
  [...ALPHABET, 'I', 'L', 'O'].flatMap((char) => {
    const value = ALPHABET.includes(char) ? ALPHABET.indexOf(char) : char === 'O' ? 0 : 1;
    return [
      [char, value],
      [char.toLowerCase(), value],
    ];
  }),
);

/** Upper case. */
export const encodeBase32 = (bytes: Uint8Array): string => {
  let text = '';
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += ALPHABET[(acc >> bits) & 31];
    }
  }
  if (bits > 0) text += ALPHABET[(acc << (5 - bits)) & 31];
  return text;
};

const invalid = (): Error => new Error('not a Crockford base32 string');

/**
 * Decodes in either case, I and L as 1, O as 0; U, hyphens and anything else
 * are refused, as are a length no encoding gives and non-zero padding bits,
 * so that one byte string has a single spelling up to the aliases.
 */
export const decodeBase32 = (text: string): Bytes => {
  if ([1, 3, 6].includes(text.length % 8)) throw invalid();
  const out = new Uint8Array(Math.floor((text.length * 5) / 8));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const char of text) {
    const value = SYMBOLS.get(char);
    if (value === undefined) throw invalid();
    acc = ((acc << 5) | value) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 0xff;
    }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) throw invalid();
  return out;
};
