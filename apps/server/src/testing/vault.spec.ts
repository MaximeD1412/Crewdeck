import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { vaultWrapAad } from '@crewdeck/contracts';
import { openItem, openWrap, publicKeyFor, sealItem, sealWrap } from './vault.js';

const b = (text: string): Buffer => Buffer.from(text, 'base64url');

// Written by the Runner (apps/runner/internal/keys/generate_test.go).
const ITEM = JSON.parse(readFileSync(new URL('../../../../packages/contracts/fixtures/crypto/item.json', import.meta.url), 'utf8')) as {
  vault: { deviceId: string; vaultKeyVersion: number; devicePrivateKey: string; devicePublicKey: string; vaultKey: string; wrap: { enc: string; ciphertext: string; tag: string } };
  items: { name: string; aad: string; plaintext: string; key: string; ciphertext: string }[];
};
const INFO = 'crewdeck/v1/vault-wrap';

describe('the scenarios’ Appareil vault', () => {
  const { vault } = ITEM;
  const wrap = { enc: b(vault.wrap.enc), ciphertext: b(vault.wrap.ciphertext), tag: b(vault.wrap.tag) };
  const aad = vaultWrapAad(vault.deviceId, vault.vaultKeyVersion);

  it('derives the Appareil’s public key from the private key', () => {
    expect(publicKeyFor(b(vault.devicePrivateKey)).toString('base64url')).toBe(vault.devicePublicKey);
  });

  it('opens the Runner’s wrap of an Appareil for itself, and refuses it under another additional data', () => {
    expect(openWrap(b(vault.devicePrivateKey), b(vault.devicePublicKey), wrap, INFO, aad).toString('base64url')).toBe(vault.vaultKey);
    expect(() => openWrap(b(vault.devicePrivateKey), b(vault.devicePublicKey), wrap, INFO, vaultWrapAad(vault.deviceId, 2))).toThrow();
  });

  it('opens the items the Runner sealed', () => {
    for (const item of ITEM.items) {
      const opened = openItem(b(vault.vaultKey), { key: item.key, ciphertext: item.ciphertext }, b(item.aad).toString('utf8'));
      expect(opened.toString('base64url'), item.name).toBe(item.plaintext);
    }
  });

  it('wraps and seals what it opens again, bound to its additional data', () => {
    const device = randomBytes(32);
    const vaultKey = randomBytes(32);
    const own = sealWrap(device, publicKeyFor(device), vaultKey, INFO, 'dev:1');
    expect(openWrap(device, publicKeyFor(device), own, INFO, 'dev:1').equals(vaultKey)).toBe(true);

    const item = sealItem(vaultKey, 'Pouvoir dupliquer une recette', 'idee:text');
    expect(b(item.key)).toHaveLength(60);
    expect(openItem(vaultKey, item, 'idee:text').toString('utf8')).toBe('Pouvoir dupliquer une recette');
    expect(() => openItem(vaultKey, item, 'autre:text')).toThrow();
  });
});
