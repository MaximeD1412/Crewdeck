import { z } from 'zod';
import { zVaultKeyVersion } from '../keys/pairing.js';
import { zSealedItem } from '../keys/sealed.js';
import { PROCESS_CREWDECK_NAME } from '../process/templates/process-crewdeck.js';
import { zId, zInstant } from '../values.js';

/**
 * The Modèles de process of a Pilote (US-97, US-111, ADR 0011 « Drafts,
 * activation, Modèles »): a copy of a Projet's active version, its
 * definition and its sealed part (the Commandes' text, sealed by the page
 * under `template:<id>`), that their next Projets may start from. « Process
 * Crewdeck » is data of the release, never one of them.
 */

/** At most this many Modèles per Pilote: the `processTemplates` slice is bounded (ADR 0008). */
export const PROCESS_TEMPLATES_MAX = 50;

/** At most this many characters in a Modèle's name, once trimmed. */
export const PROCESS_TEMPLATE_NAME_MAX = 80;

/** A Modèle's name: 1 to 80 characters, trimmed. Configuration the server reads (ADR 0003, as ADR 0011 amends it). */
export const zProcessTemplateName = z.string().trim().min(1).max(PROCESS_TEMPLATE_NAME_MAX);

/** What two names that are the same Modèle share: trimmed, lower-cased. */
export const processTemplateNameKey = (name: string): string => name.trim().toLocaleLowerCase('fr');

/** Whether `name` is « Process Crewdeck », whatever its case and outer spaces: the release's own Modèle. */
export const isReservedProcessTemplateName = (name: string): boolean => processTemplateNameKey(name) === processTemplateNameKey(PROCESS_CREWDECK_NAME);

/** The revision of a Modèle's contents (its definition, its sealed part): 1, then one more at each replacement. */
export const zProcessTemplateRevision = z.int().positive();

/**
 * A Modèle de process as the page lists it: its name, the Projet and the
 * version it was saved from (`fromProjectId` `null` once that Projet is
 * deleted), its sealed part (`null` without Commande) and how many
 * Commandes it holds. `revision` counts its contents: 1 when saved, one more
 * at each replacement (never at a rename), so that a Projet started from it
 * says which contents the page sealed again. Its definition is read when a Projet starts from it,
 * never listed. An item of the `processTemplates` slice of `GET /api/state`,
 * the answer of `POST` and `PATCH /api/process-templates`, the payload of
 * `process-template.upserted`.
 */
export const zProcessTemplate = z.object({
  id: zId,
  name: zProcessTemplateName,
  fromProjectId: zId.nullable(),
  fromVersionNumber: z.int().min(1),
  sealed: zSealedItem.nullable(),
  commandCount: z.int().min(0),
  revision: zProcessTemplateRevision,
  createdAt: zInstant,
  updatedAt: zInstant,
});
export type ProcessTemplate = z.infer<typeof zProcessTemplate>;

/**
 * `POST /api/process-templates` (session): save the active version
 * `versionNumber` of Projet `projectId` as the Modèle `id` (drawn by the page,
 * a UUIDv7, so that `sealed` is sealed under `template:<id>` before the server
 * sees it). `replace` overwrites the Pilote's Modèle of the same name, which
 * must then be `id`; without it a name taken is 409. `vaultKeyVersion`, the
 * version of the vault key `sealed` was sealed under, comes with it (a sealed
 * write, `docs/security/e2e.md`): 409 `vault.version-changed` once another
 * holder rotated it.
 */
export const zSaveProcessTemplateInput = z
  .object({
    id: zId,
    name: zProcessTemplateName,
    projectId: zId,
    versionNumber: z.int().min(1),
    sealed: zSealedItem.nullable(),
    vaultKeyVersion: zVaultKeyVersion.optional(),
    replace: z.boolean(),
  })
  .refine((input) => input.sealed === null || input.vaultKeyVersion !== undefined, {
    path: ['vaultKeyVersion'],
    message: 'Une partie chiffrée vient avec la version de la clé sous laquelle elle l’a été.',
  });
export type SaveProcessTemplateInput = z.infer<typeof zSaveProcessTemplateInput>;

/** `PATCH /api/process-templates/:id` (session): the Modèle's new name, under the same rules. */
export const zRenameProcessTemplateInput = z.object({ name: zProcessTemplateName });
export type RenameProcessTemplateInput = z.infer<typeof zRenameProcessTemplateInput>;
