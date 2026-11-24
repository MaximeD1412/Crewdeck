import type { SealedItem as WireSealedItem } from '@crewdeck/contracts';
import { fromBase64Url, utf8 } from '../keys/bytes.js';
import type { Vault } from '../keys/vault.js';
import { toWire } from '../projects/folder-check.js';

/** A Process's sealed part sealed again: on the wire, and the version of the vault key it was sealed under (E2E-4). */
export interface ResealedProcess {
  readonly sealed: WireSealedItem;
  readonly vaultKeyVersion: number;
}

/** Seals the part `withOpenedProcess` opened under `toAad`, with the vault key held now; `null` for a Process without Commande. */
export type SealProcessUnder = (toAad: string) => Promise<ResealedProcess | null>;

/**
 * The sealed part of a Process (its Commandes' text) opened once under
 * `fromAad` (`process:<projectId>`, `template:<templateId>`), for `use` to
 * seal it again under each `toAad` it needs, at each attempt of its write
 * (PROCESS-14, ADR 0011): after a rotation (E2E-4) the write seals again
 * under the new vault key, and the part it was given, its item key wrapped
 * under the former, would no longer open. The plaintext is overwritten once
 * `use` is done; a part that does not open under `fromAad` throws.
 */
export const withOpenedProcess = async <T>(
  vault: Pick<Vault, 'sealItem' | 'openItem'>,
  sealed: WireSealedItem | null,
  fromAad: string,
  use: (sealUnder: SealProcessUnder) => Promise<T>,
): Promise<T> => {
  const plaintext = sealed === null ? null : await vault.openItem({ key: fromBase64Url(sealed.key), ciphertext: fromBase64Url(sealed.ciphertext) }, utf8(fromAad));
  try {
    return await use(async (toAad) => {
      if (plaintext === null) return null;
      const resealed = await vault.sealItem(plaintext, utf8(toAad));
      return { sealed: toWire(resealed), vaultKeyVersion: resealed.vaultKeyVersion };
    });
  } finally {
    plaintext?.fill(0);
  }
};
