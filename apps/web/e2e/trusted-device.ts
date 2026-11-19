/**
 * Makes this browser the trusted Appareil of the test vault, which the
 * scenarios that show what the vault opens seed on the server
 * (`apps/server/src/testing/test-vault.ts`): its key pair, the crypto
 * vectors' (`packages/contracts/fixtures/crypto/item.json`), put in
 * IndexedDB as the page keeps its own (`src/keys/device-store.ts`), then the
 * page reloaded, which unlocks the vault at boot.
 */
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The Appareil's id on the server, `TEST_VAULT.device.id`: its wrap of the vault key is sealed for it. */
const DEVICE_ID = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d01';

const { vault } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../packages/contracts/fixtures/crypto/item.json'), 'utf8')) as {
  vault: { devicePrivateKey: string };
};

export const becomeTrustedDevice = async (page: Page): Promise<void> => {
  await page.evaluate(
    async ({ deviceId, privateKey }) => {
      const raw = Uint8Array.from(atob(privateKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
      // PKCS #8 of an X25519 private key: this prefix, then its 32 bytes.
      const prefix = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20];
      const pkcs8 = new Uint8Array([...prefix, ...raw]);
      const extractable = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
      const jwk = await crypto.subtle.exportKey('jwk', extractable);
      const publicKey = Uint8Array.from(atob((jwk.x ?? '').replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
      const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
      const request = indexedDB.open('crewdeck-keys', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('device');
      const database = await new Promise<IDBDatabase>((done, fail) => {
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
      const transaction = database.transaction('device', 'readwrite');
      transaction.objectStore('device').put({ deviceId, privateKey: key, publicKey }, 'self');
      await new Promise<void>((done, fail) => {
        transaction.oncomplete = () => done();
        transaction.onerror = transaction.onabort = () => fail(transaction.error);
      });
      database.close();
    },
    { deviceId: DEVICE_ID, privateKey: vault.devicePrivateKey },
  );
  await page.reload();
};
