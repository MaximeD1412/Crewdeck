import type { TabFolderClientMessage, TabFolderServerMessage } from '@crewdeck/contracts';
import { concat, toBase64Url, utf8 } from '../keys/bytes.js';
import type { SealedItem, Vault } from '../keys/vault.js';
import type { FolderSocket } from './folder-check.js';

/**
 * Test only (no production module imports this file).
 *
 * A vault for the tests of the folders: an item is its additional data's
 * length, the additional data and the plaintext, in clear; it opens only
 * under the same additional data, as the real one.
 */
export const fakeVault = (): Pick<Vault, 'sealItem' | 'openItem'> => ({
  sealItem: async (plaintext, aad) => ({ key: new Uint8Array(60).fill(aad.length), ciphertext: concat(aad, plaintext) }),
  openItem: async (item: SealedItem, aad) => {
    const head = item.ciphertext.subarray(0, aad.length);
    if (item.key[0] !== aad.length % 256 || head.some((byte, i) => byte !== aad[i])) throw new Error('keys: does not open');
    return new Uint8Array(item.ciphertext.subarray(aad.length));
  },
});

/** What the fake vault seals `plaintext` into under `aad`, on the wire (base64url). */
export const fakeSealed = async (plaintext: string, aad: string): Promise<{ key: string; ciphertext: string }> => {
  const item = await fakeVault().sealItem(utf8(plaintext), utf8(aad));
  return { key: toBase64Url(item.key), ciphertext: toBase64Url(item.ciphertext) };
};

/** A socket the test plays the server of: the checks the page sent, and the server's answers. */
export const fakeFolderSocket = (open = true) => {
  const sent: TabFolderClientMessage[] = [];
  const listeners = new Set<(message: TabFolderServerMessage) => void>();
  const socket: FolderSocket & { sent: TabFolderClientMessage[]; receive(message: TabFolderServerMessage): void; listening(): number } = {
    sent,
    sendFolder(message) {
      if (!open) return false;
      sent.push(message);
      return true;
    },
    onFolder(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    receive(message) {
      for (const listener of [...listeners]) listener(message);
    },
    listening: () => listeners.size,
  };
  return socket;
};
