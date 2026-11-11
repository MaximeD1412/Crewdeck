import type { VaultKeyWrap } from '@crewdeck/contracts';
import { server } from 'vitest/browser';
import { fromBase64Url, toBase64Url, utf8 } from './bytes.js';
import { memoryDeviceStore, withDeterministicRandom, x25519FromPrivateKey } from './testing.js';
import { type VaultState, createVault } from './vault.js';

const fixtures = '../../packages/contracts/fixtures/crypto/';

interface ItemVectors {
  vault: {
    deviceId: string;
    vaultKeyVersion: number;
    devicePrivateKey: string;
    vaultKey: string;
    wrap: { enc: string; ciphertext: string; tag: string };
  };
  items: { name: string; seed: string; aad: string; plaintext: string; key: string; ciphertext: string }[];
}

// Written by the Runner (internal/keys/generate_test.go): its vault, its items.
const vectors = async (): Promise<ItemVectors> => JSON.parse(await server.commands.readFile(fixtures + 'item.json')) as ItemVectors;

const setUp = async (deviceId: string | null = 'dev_01J9ZQ3M') => {
  const { vault } = await vectors();
  const { privateKey, publicKey } = await x25519FromPrivateKey(fromBase64Url(vault.devicePrivateKey));
  const devices = memoryDeviceStore({ deviceId, privateKey, publicKey });
  const states: VaultState[] = [];
  const asked: string[] = [];
  let answer: () => Promise<VaultKeyWrap> = async () => ({ ...vault.wrap, vaultKeyVersion: vault.vaultKeyVersion });
  const created = createVault({
    devices,
    fetchWrap: (id) => {
      asked.push(id);
      return answer();
    },
    onState: (state) => states.push(state),
  });
  return { vault: created, devices, states, asked, answer: (next: () => Promise<VaultKeyWrap>) => (answer = next) };
};

describe('the vault', () => {
  it('opens what the Runner sealed, and seals it again byte for byte', async () => {
    const { vault, states, asked } = await setUp();
    const { items, vault: expected } = await vectors();

    expect(await vault.unlockVault()).toBe('unlocked');
    expect(states).toEqual(['unlocked']);
    expect(asked).toEqual([expected.deviceId]);
    expect(vault.version()).toBe(1);
    expect(toBase64Url(await vault.rawVaultKeyForWrap())).toBe(expected.vaultKey);

    for (const item of items) {
      const aad = fromBase64Url(item.aad);
      const opened = await vault.openItem({ key: fromBase64Url(item.key), ciphertext: fromBase64Url(item.ciphertext) }, aad);
      expect(toBase64Url(opened), item.name).toBe(item.plaintext);

      const sealed = await withDeterministicRandom(fromBase64Url(item.seed), () => vault.sealItem(opened, aad));
      expect(toBase64Url(sealed.key), item.name).toBe(item.key);
      expect(toBase64Url(sealed.ciphertext), item.name).toBe(item.ciphertext);
    }
  });

  it('opens an item only with its own additional data', async () => {
    const { vault } = await setUp();
    await vault.unlockVault();
    const sealed = await vault.sealItem(utf8('Une Idée'), utf8('idea_01J9ZQ4C:text'));

    await expect(vault.openItem(sealed, utf8('idea_01J9ZQ4D:text'))).rejects.toThrow();
    await expect(vault.openItem(sealed, new Uint8Array())).rejects.toThrow(/additional data/);
    expect(new TextDecoder().decode(await vault.openItem(sealed, utf8('idea_01J9ZQ4C:text')))).toBe('Une Idée');
  });

  it('seals an item key under the vault key, never in the clear', async () => {
    const { vault } = await setUp();
    await vault.unlockVault();
    const sealed = await vault.sealItem(utf8('x'), utf8('a'));
    // nonce ‖ the sealed 32-byte item key ‖ tag.
    expect(sealed.key.length).toBe(12 + 32 + 16);
  });

  it('is no-device for a browser without an Appareil, or one the server has not named', async () => {
    const none = createVault({ devices: memoryDeviceStore(), fetchWrap: () => Promise.reject(new Error('never')) });
    expect(await none.unlockVault()).toBe('no-device');

    const { vault, asked } = await setUp(null);
    expect(await vault.unlockVault()).toBe('no-device');
    expect(asked).toEqual([]);
  });

  it('is no-device for an Appareil the server forgot or revoked, locked when it cannot answer', async () => {
    const { vault, answer, states } = await setUp();
    for (const [code, state] of [
      ['devices.revoked', 'no-device'],
      ['devices.not-found', 'no-device'],
      ['devices.not-trusted', 'locked'],
      [undefined, 'locked'],
    ] as const) {
      answer(() => Promise.reject(Object.assign(new Error('refused'), code ? { code } : {})));
      expect(await vault.unlockVault(), String(code)).toBe(state);
    }
    expect(states).toEqual(['no-device', 'no-device', 'locked', 'locked']);
  });

  it('stays locked on a wrap it did not seal, and seals nothing then', async () => {
    const { vault, answer } = await setUp();
    const { vault: expected } = await vectors();
    const tag = fromBase64Url(expected.wrap.tag);
    tag[0] = (tag[0] ?? 0) ^ 1;
    answer(async () => ({ ...expected.wrap, tag: toBase64Url(tag), vaultKeyVersion: 1 }));
    expect(await vault.unlockVault()).toBe('locked');

    answer(async () => ({ ...expected.wrap, vaultKeyVersion: 2 }));
    expect(await vault.unlockVault()).toBe('locked');
    expect(vault.version()).toBeNull();
    await expect(vault.sealItem(utf8('x'), utf8('a'))).rejects.toThrow(/locked/);
  });
});
