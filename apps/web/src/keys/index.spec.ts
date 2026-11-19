import { currentDeviceId, setCurrentDevice } from '../api/request.js';
import { createStore } from '../store/store.js';
import { generateKeyPair, publicKeyOf } from './crypto.js';
import { createPageKeys } from './index.js';
import { memoryDeviceStore } from './testing.js';

const SELF = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01';

describe('the page’s keys', () => {
  it('forget a revoked Appareil: its IndexedDB record cleared, the API no longer named, the vault no-device (E2E-4)', async () => {
    const { privateKey } = await generateKeyPair();
    const devices = memoryDeviceStore({ deviceId: SELF, privateKey, publicKey: await publicKeyOf(privateKey) });
    const store = createStore();
    store.setVaultState('unlocked');
    const client = { query: vi.fn(), command: vi.fn() };
    const keys = createPageKeys({ store, client, userAgent: navigator.userAgent, devices });
    setCurrentDevice(SELF);

    await keys.forgetDevice();

    expect(devices.current()).toBeNull();
    expect(currentDeviceId()).toBeNull();
    expect(store.getState().vaultState).toBe('no-device');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('an unlock asked before the Appareil was forgotten, answered after: the vault stays no-device (E2E-4)', async () => {
    const { privateKey } = await generateKeyPair();
    const devices = memoryDeviceStore({ deviceId: SELF, privateKey, publicKey: await publicKeyOf(privateKey) });
    const store = createStore();
    let answer: ((wrap: unknown) => void) | undefined;
    const client = { query: vi.fn(() => new Promise<never>((done) => (answer = done as (wrap: unknown) => void))), command: vi.fn() };
    const keys = createPageKeys({ store, client, userAgent: navigator.userAgent, devices });
    const unlocking = keys.unlockVault();
    await vi.waitFor(() => expect(answer).toBeDefined());

    await keys.forgetDevice();
    answer?.({ vaultKeyVersion: 1, enc: 'AAAA', ciphertext: 'AAAA', tag: 'AAAA' });

    expect(await unlocking).toBe('no-device');
    expect(store.getState().vaultState).toBe('no-device');
  });
});
