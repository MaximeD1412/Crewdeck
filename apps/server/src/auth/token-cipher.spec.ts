import { randomBytes } from 'node:crypto';
import { TokenCipher, TokenDecryptError } from './token-cipher.js';

const key = randomBytes(32);

describe('TokenCipher', () => {
  it('gives back the text it encrypted', () => {
    const cipher = new TokenCipher(key);

    expect(cipher.decrypt(cipher.encrypt('ghu_abc123'))).toBe('ghu_abc123');
  });

  it('stores version | 12-byte nonce | ciphertext | 16-byte tag, without the text in it', () => {
    const bytes = new TokenCipher(key).encrypt('ghu_abc123');

    expect(bytes[0]).toBe(1);
    expect(bytes.length).toBe(1 + 12 + 'ghu_abc123'.length + 16);
    expect(bytes.includes(Buffer.from('ghu_abc123'))).toBe(false);
  });

  it('draws a new nonce each time', () => {
    const cipher = new TokenCipher(key);

    expect(cipher.encrypt('ghu_abc123').equals(cipher.encrypt('ghu_abc123'))).toBe(false);
  });

  it('refuses bytes changed, cut, of another version or of another key', () => {
    const cipher = new TokenCipher(key);
    const bytes = cipher.encrypt('ghu_abc123');
    const flipped = Buffer.from(bytes);
    flipped[14] = (flipped[14] ?? 0) ^ 1;
    const versioned = Buffer.from(bytes);
    versioned[0] = 2;

    expect(() => cipher.decrypt(flipped)).toThrow(TokenDecryptError);
    expect(() => cipher.decrypt(bytes.subarray(0, 20))).toThrow(TokenDecryptError);
    expect(() => cipher.decrypt(versioned)).toThrow(TokenDecryptError);
    expect(() => new TokenCipher(randomBytes(32)).decrypt(bytes)).toThrow(TokenDecryptError);
  });

  it('needs a 32-byte key', () => {
    expect(() => new TokenCipher(randomBytes(16))).toThrow();
  });
});
