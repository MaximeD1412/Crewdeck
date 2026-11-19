import { ideaItemAad, type Idea } from '@crewdeck/contracts';
import { fromBase64Url, utf8 } from '../keys/bytes.js';
import type { Vault, VaultState } from '../keys/vault.js';

/** An Idée's text as this page can show it: on its way out of the vault, open, or not on this Appareil. */
export type IdeaText = { readonly status: 'opening' } | { readonly status: 'open'; readonly text: string } | { readonly status: 'unreadable' };

export interface IdeaPlaintext {
  /** The text of `idea`, opened once: `opening` while it is, then the page is told (`subscribe`). */
  text(idea: Pick<Idea, 'id' | 'text'>): IdeaText;
  /** Calls `fn` when a text opened or could not; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

export interface IdeaPlaintextOptions {
  readonly vault: Pick<Vault, 'openItem'>;
  /** The vault's state as the store has it. */
  readonly vaultState: () => VaultState;
  /** Settles once the boot tried to open the vault: until then a text is `opening`, not unreadable. */
  readonly settled: Promise<unknown>;
}

const OPENING: IdeaText = { status: 'opening' };
const UNREADABLE: IdeaText = { status: 'unreadable' };
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * The Idées' texts in clear (ADR 0003), in this page's memory only: never
 * in the store, never written anywhere. Each is opened once with the vault
 * key, asynchronously, and kept by its Idée's id, ciphertext and item key
 * (a rotation of the vault key rewraps the key alone, E2E-4). A vault not
 * open makes every text unreadable, until it opens; a text that does not open
 * (another vault, a ciphertext moved) stays unreadable.
 */
export const createIdeaPlaintext = ({ vault, vaultState, settled }: IdeaPlaintextOptions): IdeaPlaintext => {
  const opened = new Map<string, { readonly ciphertext: string; readonly key: string; result: IdeaText }>();
  const listeners = new Set<() => void>();
  let ready = false;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  void settled.finally(() => {
    ready = true;
    notify();
  });

  const open = (idea: Pick<Idea, 'id' | 'text'>) => {
    const entry: { readonly ciphertext: string; readonly key: string; result: IdeaText } = { ciphertext: idea.text.ciphertext, key: idea.text.key, result: OPENING };
    opened.set(idea.id, entry);
    void (async () => {
      try {
        const item = { key: fromBase64Url(idea.text.key), ciphertext: fromBase64Url(idea.text.ciphertext) };
        entry.result = { status: 'open', text: decoder.decode(await vault.openItem(item, utf8(ideaItemAad(idea.id, 'text')))) };
      } catch {
        // Locked meanwhile: tried again once it opens; otherwise it is not this vault's.
        if (vaultState() === 'unlocked') entry.result = UNREADABLE;
        else opened.delete(idea.id);
      }
      notify();
    })();
  };

  return {
    text(idea) {
      if (vaultState() !== 'unlocked') return ready ? UNREADABLE : OPENING;
      const entry = opened.get(idea.id);
      if (entry?.ciphertext === idea.text.ciphertext && entry.key === idea.text.key) return entry.result;
      open(idea);
      return OPENING;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
