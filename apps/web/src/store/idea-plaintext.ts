import { ideaItemAad, zIdeaAnalysisContent, type Idea, type IdeaAnalysisContent, type SealedItem } from '@crewdeck/contracts';
import { fromBase64Url, utf8 } from '../keys/bytes.js';
import type { Vault, VaultState } from '../keys/vault.js';

/** An Idée's text as this page can show it: on its way out of the vault, open, or not on this Appareil. */
export type IdeaText = { readonly status: 'opening' } | { readonly status: 'open'; readonly text: string } | { readonly status: 'unreadable' };

/**
 * An Idée's analysis as this page can show it (IDEE-2): none sealed yet,
 * on its way out of the vault, open (its sentences, `zIdeaAnalysisContent`),
 * or not on this Appareil (another vault, or not the shape of an analysis).
 */
export type IdeaAnalysisText =
  | { readonly status: 'none' }
  | { readonly status: 'opening' }
  | { readonly status: 'open'; readonly content: IdeaAnalysisContent }
  | { readonly status: 'unreadable' };

export interface IdeaPlaintext {
  /** The text of `idea`, opened once: `opening` while it is, then the page is told (`subscribe`). */
  text(idea: Pick<Idea, 'id' | 'text'>): IdeaText;
  /** The sentences of `idea`'s analysis, opened once like its text; `none` while it has none. */
  analysis(idea: Pick<Idea, 'id' | 'analysis'>): IdeaAnalysisText;
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

type Opened<T> = { readonly status: 'opening' } | { readonly status: 'open'; readonly value: T } | { readonly status: 'unreadable' };
type Field = 'text' | 'analysis';

const OPENING = { status: 'opening' } as const;
const UNREADABLE = { status: 'unreadable' } as const;
const NONE = { status: 'none' } as const;
const decoder = new TextDecoder('utf-8', { fatal: true });

/** What each field's plaintext is: the text as it is, the analysis as JSON of its schema (else it throws: unreadable). */
const READ: { readonly text: (plain: string) => string; readonly analysis: (plain: string) => IdeaAnalysisContent } = {
  text: (plain) => plain,
  analysis: (plain) => zIdeaAnalysisContent.parse(JSON.parse(plain)),
};

/**
 * The Idées' texts and analyses in clear (ADR 0003), in this page's memory
 * only: never in the store, never written anywhere. Each is opened once with
 * the vault key, asynchronously, under `ideaItemAad(id, field)`, and kept by
 * its Idée's id, field, ciphertext and item key (a rotation of the vault key
 * rewraps the key alone, E2E-4). A vault not open makes every one unreadable,
 * until it opens; one that does not open (another vault, a ciphertext moved,
 * an analysis not of its shape) stays unreadable.
 */
export const createIdeaPlaintext = ({ vault, vaultState, settled }: IdeaPlaintextOptions): IdeaPlaintext => {
  const opened = new Map<string, { readonly ciphertext: string; readonly key: string; result: Opened<unknown> }>();
  const listeners = new Set<() => void>();
  let ready = false;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  void settled.finally(() => {
    ready = true;
    notify();
  });

  const open = (cacheKey: string, id: string, field: Field, sealed: SealedItem) => {
    const entry: { readonly ciphertext: string; readonly key: string; result: Opened<unknown> } = { ciphertext: sealed.ciphertext, key: sealed.key, result: OPENING };
    opened.set(cacheKey, entry);
    void (async () => {
      try {
        const item = { key: fromBase64Url(sealed.key), ciphertext: fromBase64Url(sealed.ciphertext) };
        const plain = decoder.decode(await vault.openItem(item, utf8(ideaItemAad(id, field))));
        try {
          entry.result = { status: 'open', value: READ[field](plain) };
        } catch {
          entry.result = UNREADABLE;
        }
      } catch {
        // Locked meanwhile: tried again once it opens; otherwise it is not this vault's.
        if (vaultState() === 'unlocked') entry.result = UNREADABLE;
        else opened.delete(cacheKey);
      }
      notify();
    })();
  };

  /** The field `field` of the Idée `id`, sealed as `sealed`: opened once, then from memory. */
  const read = <T>(id: string, field: Field, sealed: SealedItem): Opened<T> => {
    if (vaultState() !== 'unlocked') return ready ? UNREADABLE : OPENING;
    const cacheKey = `${id}:${field}`;
    const entry = opened.get(cacheKey);
    if (entry?.ciphertext === sealed.ciphertext && entry.key === sealed.key) return entry.result as Opened<T>;
    open(cacheKey, id, field, sealed);
    return OPENING;
  };

  return {
    text(idea) {
      const result = read<string>(idea.id, 'text', idea.text);
      return result.status === 'open' ? { status: 'open', text: result.value } : result;
    },
    analysis(idea) {
      if (idea.analysis === null) return NONE;
      const result = read<IdeaAnalysisContent>(idea.id, 'analysis', idea.analysis);
      return result.status === 'open' ? { status: 'open', content: result.value } : result;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
