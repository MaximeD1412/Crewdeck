import { z } from 'zod';
import { zArtifactType } from '../process/artifact-types.js';
import { zSealedItem } from '../keys/sealed.js';
import { zProcessDefinition } from '../process/definition.js';
import { type ProcessSources, zSourceKind } from '../process/sources.js';
import { zId, zInstant } from '../values.js';
import { withSeq } from './commands.js';

/**
 * A Projet's Process (ADR 0011, « A version is one immutable document »,
 * « Drafts, activation, Modèles »): numbered Versions, immutable once
 * written, and at most one Brouillon, saved whole on every change of the
 * canvas. The sealed part (the Commandes' text) is stored as received.
 */

/** Who activated a version: the creation of the Projet (its Modèle copied), or the Pilote (PROCESS-10). */
export const PROCESS_ACTIVATIONS = ['creation', 'pilot'] as const;
export const zProcessActivation = z.enum(PROCESS_ACTIVATIONS);
export type ProcessActivation = z.infer<typeof zProcessActivation>;

/** A version of a Projet's Process: `templateName` is the Modèle it was copied from, `null` once the Pilote drew it. */
export const zProcessVersion = z.object({
  number: z.int().min(1),
  definition: zProcessDefinition,
  sealed: zSealedItem.nullable(),
  activatedAt: zInstant,
  activatedBy: zProcessActivation,
  templateName: z.string().min(1).nullable(),
});
export type ProcessVersion = z.infer<typeof zProcessVersion>;

/**
 * The Brouillon of a Projet's Process: `revision` counts its saves,
 * `baseVersion` is the version it was drawn from, `0` while the Projet has
 * none (its Modèle had a Manque at creation, ADR 0012).
 */
export const zProcessDraft = z.object({
  definition: zProcessDefinition,
  sealed: zSealedItem.nullable(),
  revision: z.int().min(1),
  baseVersion: z.int().min(0),
  updatedAt: zInstant,
});
export type ProcessDraft = z.infer<typeof zProcessDraft>;

/**
 * The Source of one group of a Projet's artifacts (ADR 0012, « Which Source
 * for what »), and since when it holds it: its creation, or its last
 * migration (SOURCE-7).
 */
export const zProjectSource = z.object({ source: zSourceKind, since: zInstant });
export type ProjectSource = z.infer<typeof zProjectSource>;

/** Both groups of a Projet: a Projet holds them from its creation. */
export const zProjectProcessSources = z.object({ ticket: zProjectSource, code: zProjectSource });
export type ProjectProcessSources = z.infer<typeof zProjectProcessSources>;

/**
 * A PhaseRun of the Projet still at work (`running` or `waiting`), and the
 * version it finishes on: what the activation's confirmation lists as
 * staying on its version (ADR 0011). `ticketNumber` names a Ticket's;
 * `null` for another item.
 */
export const zProcessRunningWork = z.object({
  phaseRunId: zId,
  versionNumber: z.int().min(1),
  itemType: zArtifactType,
  itemId: z.string().min(1).max(200),
  ticketNumber: z.int().min(1).nullable(),
});
export type ProcessRunningWork = z.infer<typeof zProcessRunningWork>;

/**
 * The whole Process of a Projet, keyed by the Projet's id: its active
 * version (`null` until a first one is activated), its draft, the Sources
 * of its groups, which the canvas and its Manques read, and the work still
 * running on a version, oldest first. The answer
 * of `GET /api/projects/:id/process` and `PUT …/process/draft`, the payload
 * of `process.upserted`, an item of the `processes` slice of `GET /api/state`.
 */
export const zProjectProcess = z.object({
  id: zId,
  active: zProcessVersion.nullable(),
  draft: zProcessDraft.nullable(),
  sources: zProjectProcessSources,
  running: z.array(zProcessRunningWork),
});
export type ProjectProcess = z.infer<typeof zProjectProcess>;

/** The Sources of a Projet's view as `findGaps` reads them: the kinds alone. */
export const processSourcesOf = (view: Pick<ProjectProcess, 'sources'>): ProcessSources => ({
  ticket: view.sources.ticket.source,
  code: view.sources.code.source,
});

/**
 * `PUT /api/projects/:id/process/draft` (session): the whole draft, the
 * `revision` it was based on (`0` for the first save) and the version it was
 * drawn from (`0` while the Projet has none). `sealed` holds the Commandes'
 * text: required when the definition has a Commande, absent otherwise.
 */
export const zProcessDraftInput = z
  .object({
    definition: zProcessDefinition,
    sealed: zSealedItem.nullable(),
    revision: z.int().min(0),
    baseVersion: z.int().min(0),
  })
  .superRefine((input, ctx) => {
    const hasCommands = input.definition.commands.length > 0;
    if (hasCommands && input.sealed === null) {
      ctx.addIssue({ code: 'custom', path: ['sealed'], message: 'Les Commandes de ce Process ont besoin de leur partie chiffrée.' });
    }
    if (!hasCommands && input.sealed !== null) {
      ctx.addIssue({ code: 'custom', path: ['sealed'], message: 'Ce Process n’a aucune Commande : il n’a pas de partie chiffrée.' });
    }
  });
export type ProcessDraftInput = z.infer<typeof zProcessDraftInput>;

/**
 * `POST /api/projects/:id/process/activate` (session), the Action sensible
 * `process.activate`: the draft's `revision` the Pilote confirmed (another
 * one: 409 `process.draft-stale`), and the `seq` of the dialog.
 */
export const zActivateProcessInput = withSeq(z.object({ revision: z.int().min(1) }));
export type ActivateProcessInput = z.infer<typeof zActivateProcessInput>;
