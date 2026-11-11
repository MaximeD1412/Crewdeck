import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** The version of `GITHUB_TOKEN_KEY` a ciphertext was made with: its first byte, and `keyVersion` beside it in the row. */
export const TOKEN_KEY_VERSION = 1;

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Bytes this key cannot open: changed, cut, of another key or of another version. */
export class TokenDecryptError extends Error {
  constructor() {
    super('The token cannot be decrypted with GITHUB_TOKEN_KEY.');
    this.name = 'TokenDecryptError';
  }
}

/**
 * The Pilote's GitHub tokens at rest (ADR 0002): AES-256-GCM with
 * `GITHUB_TOKEN_KEY`, a random 12-byte nonce each time, stored as
 * `version (1 byte) | nonce | ciphertext | tag (16 bytes)`.
 */
export class TokenCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_BYTES) throw new Error(`GITHUB_TOKEN_KEY must be ${KEY_BYTES} bytes, not ${key.length}`);
  }

  encrypt(text: string): Buffer {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.of(TOKEN_KEY_VERSION), nonce, ciphertext, cipher.getAuthTag()]);
  }

  /** The text of `bytes`; throws `TokenDecryptError` for bytes this key did not make. */
  decrypt(bytes: Uint8Array): string {
    const data = Buffer.from(bytes);
    if (data.length < 1 + NONCE_BYTES + TAG_BYTES || data[0] !== TOKEN_KEY_VERSION) throw new TokenDecryptError();
    const nonce = data.subarray(1, 1 + NONCE_BYTES);
    const tag = data.subarray(data.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(data.subarray(1 + NONCE_BYTES, data.length - TAG_BYTES)), decipher.final()]).toString('utf8');
    } catch {
      throw new TokenDecryptError();
    }
  }
}
