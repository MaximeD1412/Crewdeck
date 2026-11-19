import { webcrypto } from 'node:crypto';
import type { SealedItem } from '@crewdeck/contracts';
import { newId } from '../ids.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Test only: the vault of the crypto vectors (`packages/contracts/fixtures/
 * crypto/item.json`) and a trusted Appareil holding it, for the scenarios
 * that show what the vault opens. The Appareil's key pair is the vectors';
 * its wrap of the vault key, for its own id at version 1, was sealed once by
 * the page's `sealWrap` (`apps/web/src/keys/crypto.ts`). The e2e put the
 * Appareil in the browser (`apps/web/e2e/trusted-device.ts`); the server only
 * keeps its public key and its wrap, as for a real one.
 */
export const TEST_VAULT = {
  vaultKey: 'M2R0Pfnf_rCBjvV-kIOBd7R_TFqX_nbyO6MM7Siy8oI',
  device: {
    id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d01',
    publicKey: 'G66tf7NtzFwTuMRQsXycMQBdtICYUJm3f3P5FsGLjWc',
    wrap: {
      enc: 'DoE88jFHdJk8h7XJZy_OF0TRbtF7ATJ-m3Wacrv1L2c',
      ciphertext: 'c9x8ko3qLB6QhgSG-jK7yKgXCZen2tWAe4ID0gdhAGg8gafn00_SAW2f0a-x5R1q',
      tag: 'mFLz-UJz-MohqUaJpu4nDjR_IQ9t3xECkPW5EwhViHk',
    },
  },
} as const;

const bytes = (base64url: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(base64url, 'base64url'));

/** The Pilote's vault at version 1, and the trusted Appareil « Ce navigateur » that holds it. */
export const seedTrustedDevice = async (prisma: PrismaService, pilotId: string): Promise<void> => {
  const { device } = TEST_VAULT;
  await prisma.unscoped.pilot.update({ where: { id: pilotId }, data: { vaultKeyVersion: 1 } });
  await prisma.unscoped.device.create({
    data: { id: device.id, pilotId, name: 'Chrome sur Linux', publicKey: bytes(device.publicKey), state: 'trusted', approvedAt: new Date() },
  });
  await prisma.unscoped.vaultKeyWrap.create({
    data: {
      id: newId(),
      pilotId,
      holderType: 'device',
      holderId: device.id,
      vaultKeyVersion: 1,
      enc: bytes(device.wrap.enc),
      ciphertext: bytes(device.wrap.ciphertext),
      tag: bytes(device.wrap.tag),
    },
  });
};

const aesGcmSeal = async (key: webcrypto.CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<Buffer> => {
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const sealed = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, key, plaintext);
  return Buffer.concat([nonce, new Uint8Array(sealed)]);
};

/**
 * `plaintext` sealed under the test vault as the page's `Vault.sealItem`:
 * a new item key sealed by the vault key under « crewdeck/v1/item-key » ‖
 * `aad`, the content sealed by the item key under `aad`.
 */
export const sealTestItem = async (plaintext: string, aad: string): Promise<SealedItem> => {
  const vaultKey = await webcrypto.subtle.importKey('raw', bytes(TEST_VAULT.vaultKey), 'AES-GCM', false, ['encrypt']);
  const rawItemKey = webcrypto.getRandomValues(new Uint8Array(32));
  const itemKey = await webcrypto.subtle.importKey('raw', rawItemKey, 'AES-GCM', false, ['encrypt']);
  const additional = Buffer.from(aad, 'utf8');
  const key = await aesGcmSeal(vaultKey, rawItemKey, Buffer.concat([Buffer.from('crewdeck/v1/item-key', 'utf8'), additional]));
  const ciphertext = await aesGcmSeal(itemKey, Buffer.from(plaintext, 'utf8'), additional);
  return { key: key.toString('base64url'), ciphertext: ciphertext.toString('base64url') };
};
