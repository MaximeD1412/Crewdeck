/**
 * Test only: the seam that fixes the randomness of the primitives (the
 * ephemeral keys, the AES keys, the nonces) to replay the vectors shared
 * with the Runner. No production module imports this file, and `entropy.ts`
 * ignores the replacement outside Vitest; production-build.spec.ts proves
 * none of it reaches dist/.
 *
 * The deterministic stream is the Runner's (internal/keys/random_test.go):
 * block i = HMAC-SHA256(seed, "crewdeck/test/random" ‖ uint32be(i)), the
 * blocks concatenated, each draw taking the next bytes.
 */
import { type Bytes, concat, own, utf8 } from './bytes.js';
import { publicKeyOf } from './crypto.js';
import { type Entropy, replaceEntropy } from './entropy.js';
import type { DeviceStore, StoredDevice } from './device-store.js';

const STREAM_LABEL = utf8('crewdeck/test/random');

// PKCS #8 of an X25519 private key (RFC 8410): this prefix, then the 32 bytes.
const PKCS8_X25519 = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

/** A key pair from raw private bytes (non-extractable private key), with the raw public key. */
export const x25519FromPrivateKey = async (
  raw: Uint8Array,
): Promise<{ privateKey: CryptoKey; publicKey: Bytes; pair: CryptoKeyPair }> => {
  const privateKey = await crypto.subtle.importKey('pkcs8', concat(PKCS8_X25519, raw), { name: 'X25519' }, false, [
    'deriveBits',
  ]);
  const publicKey = await publicKeyOf(privateKey);
  const publicCryptoKey = await crypto.subtle.importKey('raw', publicKey, { name: 'X25519' }, true, []);
  return { privateKey, publicKey, pair: { privateKey, publicKey: publicCryptoKey } };
};

const fromBytes = (bytes: (length: number) => Promise<Bytes>): Entropy => ({
  bytes,
  x25519: async () => (await x25519FromPrivateKey(await bytes(32))).pair,
  aes256: async (extractable) =>
    crypto.subtle.importKey('raw', await bytes(32), 'AES-GCM', extractable, ['encrypt', 'decrypt']),
});

const deterministicStream = (seed: Uint8Array): ((length: number) => Promise<Bytes>) => {
  const key = crypto.subtle.importKey('raw', own(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  let counter = 0;
  let buffer: Bytes = new Uint8Array(0);
  return async (length) => {
    while (buffer.length < length) {
      const index = new Uint8Array(4);
      new DataView(index.buffer).setUint32(0, counter++);
      const block = new Uint8Array(await crypto.subtle.sign('HMAC', await key, concat(STREAM_LABEL, index)));
      buffer = concat(buffer, block);
    }
    const drawn = buffer.slice(0, length);
    buffer = buffer.slice(length);
    return drawn;
  };
};

const withEntropy = async <T>(source: Entropy, run: () => Promise<T>): Promise<T> => {
  replaceEntropy(source);
  try {
    return await run();
  } finally {
    replaceEntropy(undefined);
  }
};

/** Runs `run` with every random value drawn from the seed's stream. */
export const withDeterministicRandom = <T>(seed: Uint8Array, run: () => Promise<T>): Promise<T> =>
  withEntropy(fromBytes(deterministicStream(seed)), run);

/** Runs `run` handing out exactly these bytes, then failing (the RFC's ephemeral key). */
export const withFixedRandom = <T>(bytes: Uint8Array, run: () => Promise<T>): Promise<T> => {
  let rest = own(bytes);
  return withEntropy(
    fromBytes(async (length) => {
      if (rest.length < length) throw new Error('fixed random exhausted');
      const drawn = rest.slice(0, length);
      rest = rest.slice(length);
      return drawn;
    }),
    run,
  );
};

/** The first `length` bytes of the seed's stream. */
export const deterministicBytes = (seed: Uint8Array, length: number): Promise<Bytes> =>
  deterministicStream(seed)(length);

/** The device store in memory, for the specs that do not test IndexedDB. */
export const memoryDeviceStore = (initial: StoredDevice | null = null): DeviceStore & { current: () => StoredDevice | null } => {
  let device = initial;
  return {
    current: () => device,
    getDevice: async () => device,
    saveDevice: async (next) => {
      device = next;
    },
    clearDevice: async () => {
      device = null;
    },
  };
};
