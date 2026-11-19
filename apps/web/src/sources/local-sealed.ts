import { localTextAad, type SealedItem } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { fromBase64Url, utf8 } from '../keys/bytes.js';
import type { Vault, VaultState } from '../keys/vault.js';

export interface LocalTexts {
  /**
   * A Local Projet's text sealed by its Runner (SOURCE-3, ADR 0012): a
   * Ticket's title (`ticket:<n>:title`), its other labels
   * (`ticket:<n>:labels`), a milestone's or a change's title, an unreadable
   * file's path (`unreadable:<key>:path`). « … » while the vault is locked,
   * while it opens, or when it is not this Projet's at this place.
   */
  openLocalText(projectId: string, sealed: SealedItem, place: string): string;
  /** Calls `fn` when a text opened; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * The Local Projets' texts in clear, in this page's memory only: each opened
 * once with the vault key under `local:<projectId>:<place>`, asynchronously,
 * and kept by its value (its additional data, ciphertext and item key), as
 * the Projets' names are (`projects.ts`).
 */
export const createLocalTexts = ({ vault, vaultState }: { readonly vault: Pick<Vault, 'openItem'>; readonly vaultState: () => VaultState }): LocalTexts => {
  const opened = new Map<string, { text: string | null }>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const open = (id: string, aad: string, sealed: SealedItem) => {
    const entry: { text: string | null } = { text: null };
    opened.set(id, entry);
    void (async () => {
      try {
        entry.text = decoder.decode(await vault.openItem({ key: fromBase64Url(sealed.key), ciphertext: fromBase64Url(sealed.ciphertext) }, utf8(aad)));
        notify();
      } catch {
        // Locked meanwhile: tried again once it opens; otherwise it is not this vault's, or not this place's, and stays « … ».
        if (vaultState() !== 'unlocked') opened.delete(id);
      }
    })();
  };

  return {
    openLocalText(projectId, sealed, place) {
      const pending = t('local.text.pending');
      if (vaultState() !== 'unlocked') return pending;
      const aad = localTextAad(projectId, place);
      const id = `${aad}\u0000${sealed.key}\u0000${sealed.ciphertext}`;
      const entry = opened.get(id);
      if (!entry) {
        open(id, aad, sealed);
        return pending;
      }
      return entry.text ?? pending;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
