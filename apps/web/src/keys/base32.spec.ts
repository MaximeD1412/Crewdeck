import { server } from 'vitest/browser';
import { decodeBase32, encodeBase32 } from './base32.js';
import { fromBase64Url } from './bytes.js';

interface Base32Vectors {
  encode: { bytes: string; text: string }[];
  decode: { bytes: string; text: string }[];
  invalid: string[];
}

const vectors = async (): Promise<Base32Vectors> =>
  JSON.parse(await server.commands.readFile('../../packages/contracts/fixtures/crypto/base32.json')) as Base32Vectors;

describe('Crockford base32', () => {
  it('encodes as the Runner does', async () => {
    for (const c of (await vectors()).encode) {
      expect(encodeBase32(fromBase64Url(c.bytes))).toBe(c.text);
    }
  });

  it('decodes the encodings, lower case and the aliases I, L and O', async () => {
    const v = await vectors();
    for (const c of [...v.encode, ...v.decode]) {
      expect(decodeBase32(c.text), c.text).toEqual(fromBase64Url(c.bytes));
    }
  });

  it('refuses U, hyphens, padding and lengths no encoding gives', async () => {
    for (const text of (await vectors()).invalid) {
      expect(() => decodeBase32(text), text).toThrow(/base32/);
    }
  });

  it('round-trips every length, a 128-bit secret in 26 characters', () => {
    for (let length = 0; length <= 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      const text = encodeBase32(bytes);
      expect(text).toHaveLength(Math.ceil((length * 8) / 5));
      expect(text).toMatch(/^[0-9A-HJKMNP-TV-Z]*$/);
      expect(decodeBase32(text)).toEqual(bytes);
    }
    expect(encodeBase32(new Uint8Array(16))).toHaveLength(26);
  });
});
