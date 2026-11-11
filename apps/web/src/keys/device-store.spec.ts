import { toBase64Url } from './bytes.js';
import { createDeviceStore } from './device-store.js';
import { createLinkKeys } from './pairing.js';

// IndexedDB is per origin: only this file touches the real database.
describe('the device store', () => {
  const devices = createDeviceStore();
  const vault = { state: () => 'locked' as const, version: () => null, rawVaultKeyForWrap: () => Promise.reject(new Error('locked')) };
  beforeEach(() => devices.clearDevice());

  it('keeps the Appareil drawn for the first code, with its id once the server named it', async () => {
    const keys = createLinkKeys({ devices, vault, userAgent: 'Chrome/130.0 Safari/537.36 (X11; Linux x86_64)' });
    const first = await keys.browserPairing();
    expect(await devices.getDevice()).toMatchObject({ deviceId: null });

    await keys.adoptDevice('dev_01J9ZQ3M');
    const again = await createLinkKeys({ devices, vault, userAgent: '' }).browserPairing();

    expect(again.devicePublicKey).toBe(first.devicePublicKey);
    const stored = await devices.getDevice();
    expect(stored?.deviceId).toBe('dev_01J9ZQ3M');
    expect(toBase64Url(stored?.publicKey ?? new Uint8Array())).toBe(first.devicePublicKey);
  });

  it('keeps a private key nobody can export, even after IndexedDB', async () => {
    await createLinkKeys({ devices, vault, userAgent: '' }).browserPairing();
    const stored = await devices.getDevice();
    if (!stored) throw new Error('no device');

    expect(stored.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', stored.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', stored.privateKey)).rejects.toThrow();
  });

  it('forgets the Appareil', async () => {
    await createLinkKeys({ devices, vault, userAgent: '' }).browserPairing();
    await devices.clearDevice();
    expect(await devices.getDevice()).toBeNull();
  });
});
