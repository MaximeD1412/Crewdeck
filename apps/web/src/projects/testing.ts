import { vaultWrapAad, type TabFolderClientMessage, type TabFolderServerMessage } from '@crewdeck/contracts';
import { concat, fromBase64Url, toBase64Url, utf8 } from '../keys/bytes.js';
import { INFO, sealWrap } from '../keys/crypto.js';
import { memoryDeviceStore, x25519FromPrivateKey } from '../keys/testing.js';
import { createVault, type SealedItem, type SealedUnder, type Vault } from '../keys/vault.js';
import type { FolderSocket } from './folder-check.js';

/**
 * Test only (no production module imports this file).
 *
 * A vault for the tests of the folders: an item is its additional data's
 * length, the additional data and the plaintext, in clear; it opens only
 * under the same additional data, as the real one. It seals under `version`,
 * which a test moves to play a rotation; `unlocks` counts the unlocks.
 */
export const fakeVault = () => {
  const vault: Pick<Vault, 'sealItem' | 'openItem' | 'unlockVault'> & { version: number; unlocks: number } = {
    version: 1,
    unlocks: 0,
    sealItem: async (plaintext: Uint8Array, aad: Uint8Array): Promise<SealedUnder> => ({
      key: new Uint8Array(60).fill(aad.length),
      ciphertext: concat(aad, plaintext),
      vaultKeyVersion: vault.version,
    }),
    openItem: async (item: Pick<SealedItem, 'key' | 'ciphertext'>, aad: Uint8Array) => {
      const head = item.ciphertext.subarray(0, aad.length);
      if (item.key[0] !== aad.length % 256 || head.some((byte, i) => byte !== aad[i])) throw new Error('keys: does not open');
      return new Uint8Array(item.ciphertext.subarray(aad.length));
    },
    unlockVault: async () => {
      vault.unlocks += 1;
      return 'unlocked' as const;
    },
  };
  return vault;
};

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

/**
 * A real vault (`createVault`, AES-256-GCM under a random vault key), on an
 * Appareil that sealed its own wrap, unlocked under version 1. `rotate()`
 * plays another holder's rotation (E2E-4): a new vault key, really another
 * one, under the next version, which the next unlock fetches; an item whose
 * key was wrapped under the former no longer opens.
 */
export const rotatingVault = async () => {
  const { privateKey, publicKey } = await x25519FromPrivateKey(crypto.getRandomValues(new Uint8Array(32)));
  const deviceId = 'dev_rotation';
  let key = crypto.getRandomValues(new Uint8Array(32));
  let version = 1;
  const vault = createVault({
    devices: memoryDeviceStore({ deviceId, privateKey, publicKey }),
    fetchWrap: async () => {
      const wrap = await sealWrap(privateKey, publicKey, key, INFO.vaultWrap, utf8(vaultWrapAad(deviceId, version)));
      return { enc: toBase64Url(wrap.enc), ciphertext: toBase64Url(wrap.ciphertext), tag: toBase64Url(wrap.tag), vaultKeyVersion: version };
    },
  });
  if ((await vault.unlockVault()) !== 'unlocked') throw new Error('testing: the vault did not unlock');
  return {
    vault,
    rotate: () => {
      key = crypto.getRandomValues(new Uint8Array(32));
      version += 1;
    },
    /** `plaintext` sealed under `aad` with the vault key held, on the wire. */
    seal: async (plaintext: string, aad: string) => {
      const item = await vault.sealItem(utf8(plaintext), utf8(aad));
      return { key: toBase64Url(item.key), ciphertext: toBase64Url(item.ciphertext) };
    },
    /** A wire item opened under `aad` with the vault key held. */
    open: async (item: { key: string; ciphertext: string }, aad: string) =>
      new TextDecoder().decode(await vault.openItem({ key: fromBase64Url(item.key), ciphertext: fromBase64Url(item.ciphertext) }, utf8(aad))),
  };
};
