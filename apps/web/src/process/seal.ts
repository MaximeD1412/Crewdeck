import type { SealedItem as WireSealedItem } from '@crewdeck/contracts';
import { fromBase64Url, utf8 } from '../keys/bytes.js';
import type { Vault } from '../keys/vault.js';
import { toWire } from '../projects/folder-check.js';

/** A Process's sealed part sealed again: on the wire, and the version of the vault key it was sealed under (E2E-4). */
export interface ResealedProcess {
  readonly sealed: WireSealedItem;
  readonly vaultKeyVersion: number;
}

/**
 * The sealed part of a Process (its Commandes' text) moved from one
 * additional data to another (PROCESS-14, ADR 0011): opened under `fromAad`
 * (`process:<projectId>`, `template:<templateId>`), sealed again under
 * `toAad`, so that a Modèle or a new Projet holds its own, with the version
 * of the vault key its write carries. `null` (no Commande) stays `null`; a
 * part that does not open under `fromAad` throws.
 */
export const resealProcess = async (vault: Pick<Vault, 'sealItem' | 'openItem'>, sealed: WireSealedItem | null, fromAad: string, toAad: string): Promise<ResealedProcess | null> => {
  if (sealed === null) return null;
  const plaintext = await vault.openItem({ key: fromBase64Url(sealed.key), ciphertext: fromBase64Url(sealed.ciphertext) }, utf8(fromAad));
  try {
    const resealed = await vault.sealItem(plaintext, utf8(toAad));
    return { sealed: toWire(resealed), vaultKeyVersion: resealed.vaultKeyVersion };
  } finally {
    plaintext.fill(0);
  }
};
