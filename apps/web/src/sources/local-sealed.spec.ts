import type { VaultKeyWrap } from '@crewdeck/contracts';
import { server } from 'vitest/browser';
import { fromBase64Url } from '../keys/bytes.js';
import { memoryDeviceStore, x25519FromPrivateKey } from '../keys/testing.js';
import { createVault, type VaultState } from '../keys/vault.js';
import { createLocalTexts } from './local-sealed.js';

interface ItemVectors {
  vault: { vaultKeyVersion: number; devicePrivateKey: string; wrap: { enc: string; ciphertext: string; tag: string } };
  items: { name: string; key: string; ciphertext: string }[];
}

// Sealed by the Runner (internal/keys/generate_test.go), as its report sends them.
const PROJECT_ID = '019a6f00-0000-7000-8000-0000000000b1';

const setUp = async (initial: VaultState = 'unlocked') => {
  const vectors = JSON.parse(await server.commands.readFile('../../packages/contracts/fixtures/crypto/item.json')) as ItemVectors;
  const { privateKey, publicKey } = await x25519FromPrivateKey(fromBase64Url(vectors.vault.devicePrivateKey));
  const vault = createVault({
    devices: memoryDeviceStore({ deviceId: 'dev_01J9ZQ3M', privateKey, publicKey }),
    fetchWrap: async (): Promise<VaultKeyWrap> => ({ ...vectors.vault.wrap, vaultKeyVersion: vectors.vault.vaultKeyVersion }),
  });
  await vault.unlockVault();
  let state = initial;
  const texts = createLocalTexts({ vault, vaultState: () => state });
  const changes = vi.fn<() => void>();
  texts.subscribe(changes);
  const sealed = (name: string) => {
    const item = vectors.items.find((candidate) => candidate.name === name);
    if (!item) throw new Error(`item.json lacks ${name}`);
    return { key: item.key, ciphertext: item.ciphertext };
  };
  return { texts, changes, sealed, unlock: () => (state = 'unlocked') };
};

const settle = async (changes: ReturnType<typeof vi.fn>, times = 1) => {
  await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(times));
};

describe('the texts of a Local Projet', () => {
  it('opens a Ticket’s title and its other labels once, « … » meanwhile, and tells the page', async () => {
    const { texts, changes, sealed } = await setUp();

    expect(texts.openLocalText(PROJECT_ID, sealed('local-ticket-title'), 'ticket:12:title')).toBe('…');
    await settle(changes);
    expect(texts.openLocalText(PROJECT_ID, sealed('local-ticket-title'), 'ticket:12:title')).toBe('Panier partagé');

    expect(texts.openLocalText(PROJECT_ID, sealed('local-ticket-labels'), 'ticket:12:labels')).toBe('…');
    await settle(changes, 2);
    expect(JSON.parse(texts.openLocalText(PROJECT_ID, sealed('local-ticket-labels'), 'ticket:12:labels'))).toEqual(['revue-visuelle', 'type:fix']);
  });

  it('opens a milestone’s and a change’s title, and an unreadable file’s path', async () => {
    const { texts, changes, sealed } = await setUp();
    texts.openLocalText(PROJECT_ID, sealed('local-milestone-title'), 'milestone:1:title');
    texts.openLocalText(PROJECT_ID, sealed('local-change-title'), 'change:31:title');
    texts.openLocalText(PROJECT_ID, sealed('local-unreadable-path'), 'unreadable:AAECAwQFBgcICQoLDA0ODw:path');
    await settle(changes, 3);
    expect(texts.openLocalText(PROJECT_ID, sealed('local-milestone-title'), 'milestone:1:title')).toBe('Bêta');
    expect(texts.openLocalText(PROJECT_ID, sealed('local-change-title'), 'change:31:title')).toBe('Panier partagé');
    expect(texts.openLocalText(PROJECT_ID, sealed('local-unreadable-path'), 'unreadable:AAECAwQFBgcICQoLDA0ODw:path')).toBe('tickets/7-courses.md');
  });

  it('does not open a title under another Ticket’s number, nor another Projet’s', async () => {
    const { texts, changes, sealed } = await setUp();
    texts.openLocalText(PROJECT_ID, sealed('local-ticket-title'), 'ticket:13:title');
    texts.openLocalText('019a6f00-0000-7000-8000-0000000000b2', sealed('local-ticket-title'), 'ticket:12:title');
    texts.openLocalText(PROJECT_ID, sealed('local-ticket-title'), 'ticket:12:title');
    await settle(changes);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(changes).toHaveBeenCalledTimes(1);
    expect(texts.openLocalText(PROJECT_ID, sealed('local-ticket-title'), 'ticket:13:title')).toBe('…');
    expect(texts.openLocalText('019a6f00-0000-7000-8000-0000000000b2', sealed('local-ticket-title'), 'ticket:12:title')).toBe('…');
  });

  it('is « … » while the vault is locked, opened once it is not', async () => {
    const { texts, changes, sealed, unlock } = await setUp('locked');
    expect(texts.openLocalText(PROJECT_ID, sealed('local-ticket-title'), 'ticket:12:title')).toBe('…');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(changes).not.toHaveBeenCalled();

    unlock();
    texts.openLocalText(PROJECT_ID, sealed('local-ticket-title'), 'ticket:12:title');
    await settle(changes);
    expect(texts.openLocalText(PROJECT_ID, sealed('local-ticket-title'), 'ticket:12:title')).toBe('Panier partagé');
  });
});
