import type { Bytes } from './bytes.js';

/**
 * Where every random value of the primitives comes from: the key pairs, the
 * AES keys, the HPKE ephemeral keys and the nonces. The tests replace it
 * (`testing.ts`) to replay the shared vectors; outside Vitest's `test` mode
 * the replacement is compiled away, so a production build always draws from
 * WebCrypto.
 */
export interface Entropy {
  bytes(length: number): Promise<Bytes>;
  /** An X25519 key pair whose private key is non-extractable. */
  x25519(): Promise<CryptoKeyPair>;
  aes256(extractable: boolean): Promise<CryptoKey>;
}

const AES_USAGES: KeyUsage[] = ['encrypt', 'decrypt'];

const webCrypto: Entropy = {
  bytes: async (length) => crypto.getRandomValues(new Uint8Array(length)),
  x25519: () => crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as Promise<CryptoKeyPair>,
  aes256: (extractable) => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, AES_USAGES),
};

let replacement: Entropy | undefined;

export const entropy = (): Entropy => (import.meta.env.MODE === 'test' && replacement) || webCrypto;

/** Test only: `testing.ts` calls it; it throws outside Vitest. */
export const replaceEntropy = (next: Entropy | undefined): void => {
  if (import.meta.env.MODE !== 'test') throw new Error('the entropy is replaced only in tests');
  replacement = next;
};
