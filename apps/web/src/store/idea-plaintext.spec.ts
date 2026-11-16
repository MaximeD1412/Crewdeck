import { ideaItemAad } from '@crewdeck/contracts';
import { fromBase64Url, toBase64Url, utf8 } from '../keys/bytes.js';
import type { SealedItem, VaultState } from '../keys/vault.js';
import { createIdeaPlaintext } from './idea-plaintext.js';

const ID = '0193a4f2-7c1e-7a10-8c2c-000000000064';
const OTHER = '0193a4f2-7c1e-7a10-8c2c-000000000063';
const sealedOf = (text: string) => ({ key: toBase64Url(utf8('key')), ciphertext: toBase64Url(utf8(text)) });

/** A vault that « opens » an item whose ciphertext is its text in UTF-8, under the additional data of `ID` only. */
const fakeVault = () => {
  const calls: string[] = [];
  return {
    calls,
    openItem: vi.fn(async (item: SealedItem, aad: Uint8Array) => {
      calls.push(new TextDecoder().decode(aad));
      if (new TextDecoder().decode(aad) !== ideaItemAad(ID, 'text')) throw new Error('OperationError');
      return new Uint8Array(item.ciphertext);
    }),
  };
};

const setup = (initial: VaultState = 'unlocked') => {
  let state: VaultState = initial;
  let settle: () => void = () => undefined;
  const vault = fakeVault();
  const plaintext = createIdeaPlaintext({ vault, vaultState: () => state, settled: new Promise<void>((resolve) => (settle = resolve)) });
  const changed = vi.fn<() => void>();
  plaintext.subscribe(changed);
  return { plaintext, vault, changed, settle, setState: (next: VaultState) => (state = next) };
};

describe('createIdeaPlaintext', () => {
  it('opens a text once, asynchronously, under "<id>:text", then tells the page', async () => {
    const { plaintext, vault, changed } = setup();
    const idea = { id: ID, text: sealedOf('Pouvoir dupliquer une recette') };
    expect(plaintext.text(idea)).toEqual({ status: 'opening' });
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(plaintext.text(idea)).toEqual({ status: 'open', text: 'Pouvoir dupliquer une recette' });
    expect(plaintext.text(idea)).toEqual({ status: 'open', text: 'Pouvoir dupliquer une recette' });
    expect(vault.calls).toEqual([`${ID}:text`]);
    expect(fromBase64Url(idea.text.ciphertext)).toEqual(utf8('Pouvoir dupliquer une recette'));
  });

  it('says « illisible » for a text that does not open with this vault', async () => {
    const { plaintext, changed } = setup();
    const moved = { id: OTHER, text: sealedOf('Une autre') };
    plaintext.text(moved);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(plaintext.text(moved)).toEqual({ status: 'unreadable' });
  });

  it('opens again a text whose ciphertext changed', async () => {
    const { plaintext, changed } = setup();
    plaintext.text({ id: ID, text: sealedOf('Avant') });
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(plaintext.text({ id: ID, text: sealedOf('Après') })).toEqual({ status: 'opening' });
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(plaintext.text({ id: ID, text: sealedOf('Après') })).toEqual({ status: 'open', text: 'Après' });
  });

  it('while the boot opens the vault, says « Déchiffrement… »; with the vault still shut after it, « illisible », until it opens', async () => {
    const { plaintext, vault, changed, settle, setState } = setup('locked');
    const idea = { id: ID, text: sealedOf('Pouvoir dupliquer une recette') };
    expect(plaintext.text(idea)).toEqual({ status: 'opening' });
    settle();
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(plaintext.text(idea)).toEqual({ status: 'unreadable' });
    expect(vault.openItem).not.toHaveBeenCalled();
    setState('unlocked');
    expect(plaintext.text(idea)).toEqual({ status: 'opening' });
    await vi.waitFor(() => expect(plaintext.text(idea)).toEqual({ status: 'open', text: 'Pouvoir dupliquer une recette' }));
  });

  it('keeps nothing in clear outside its memory: no storage written', async () => {
    const { plaintext, changed } = setup();
    plaintext.text({ id: ID, text: sealedOf('Secret') });
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
