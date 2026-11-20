import { z } from 'zod';
import { withSeq } from './commands.js';
import { zRoleId } from './roles.js';
import { IDEA_ANALYSIS_LIMITS, IDEA_ANALYSIS_NEW_PROJECT } from '../contrats/idea-analysis.js';
import { zBytes, zVaultKeyVersion } from '../keys/pairing.js';
import { zSealedItem } from '../keys/sealed.js';
import { zEngineId } from '../runner/engines.js';
import { zCursorPage, zId, zInstant } from '../values.js';

/**
 * Where an Idée stands (US-5): its analysis running, to triage (the analysis
 * could not run, or not yet), analysed, then triaged: retained, merged into
 * another, rejected. The UI says « en analyse », « à trier », « analysée »,
 * « retenue », « fusionnée », « rejetée ».
 */
export const IDEA_STATES = ['analysing', 'to-triage', 'analysed', 'retained', 'merged', 'rejected'] as const;
export const zIdeaState = z.enum(IDEA_STATES);
export type IdeaState = z.infer<typeof zIdeaState>;

/** The states the Pilote still has to triage: the tab « À trier » and the Décision `ideas-to-triage`. */
export const IDEA_TO_TRIAGE_STATES = ['analysing', 'to-triage', 'analysed'] as const satisfies readonly IdeaState[];

/** Triaged away: the `ideas` slice keeps them 90 days, `GET /api/ideas` pages the older ones. */
export const IDEA_CLOSED_STATES = ['merged', 'rejected'] as const satisfies readonly IdeaState[];

/** Where the Pilote noted it: below 1280 px the page says `telephone`. */
export const zIdeaNotedFrom = z.enum(['pc', 'telephone']);
export type IdeaNotedFrom = z.infer<typeof zIdeaNotedFrom>;

/** An Idée's text, at most this many characters: one sentence, a few at most. */
export const IDEA_TEXT_MAX = 500;

/**
 * The additional data of an Idée's sealed field (`docs/security/e2e.md`,
 * « Items under the vault key »): `"<ideaId>:<field>"`, so the server cannot
 * move a text to another Idée nor to another field.
 */
export const ideaItemAad = (ideaId: string, field: 'text' | 'analysis' | 'reason'): string => `${ideaId}:${field}`;

/**
 * An Idée's text, sealed by the page: an empty plaintext seals to 28 bytes
 * (the nonce and the tag), so a text is at least 29; at most `IDEA_TEXT_MAX`
 * characters of 4 bytes.
 */
export const zIdeaText = z.strictObject({ key: zSealedItem.shape.key, ciphertext: zBytes(29, 12 + IDEA_TEXT_MAX * 4 + 16) });

/** An impact or an effort (US-6): a figure from 1 to 5, which the page says « faible », « moyen » or « fort ». */
export const zIdeaRating = z.int().min(1).max(5);

/**
 * The readable figures of an analysis (ADR 0003), the `figures` of the
 * `step.report` of an `idea-analysis` StepRun: the Runner reads them from the
 * report its Contrat passed, `projectId` being the Projet visé or
 * `nouveau`, `duplicateIds` the open Idées it may repeat.
 */
export const zIdeaAnalysisFigures = z.strictObject({
  impact: zIdeaRating,
  effort: zIdeaRating,
  projectId: z.union([zId, z.literal(IDEA_ANALYSIS_NEW_PROJECT)]),
  duplicateIds: z.array(zId).max(IDEA_ANALYSIS_LIMITS.duplicates),
});
export type IdeaAnalysisFigures = z.infer<typeof zIdeaAnalysisFigures>;

const zAnalysisText = (max: number) => z.string().min(1).max(max);

/**
 * The sentences of an analysis, the plaintext of an Idée's `analysis`: the
 * Runner seals them under `ideaItemAad(ideaId, 'analysis')` before they leave
 * it (ADR 0003), the page opens them with the vault key.
 */
export const zIdeaAnalysisContent = z.object({
  title: zAnalysisText(IDEA_ANALYSIS_LIMITS.title),
  summary: zAnalysisText(IDEA_ANALYSIS_LIMITS.summary),
  projectWhy: zAnalysisText(IDEA_ANALYSIS_LIMITS.why),
  impactWhy: zAnalysisText(IDEA_ANALYSIS_LIMITS.why),
  effortWhy: zAnalysisText(IDEA_ANALYSIS_LIMITS.why),
  duplicates: z.array(z.object({ id: zId, why: zAnalysisText(IDEA_ANALYSIS_LIMITS.why) })).max(IDEA_ANALYSIS_LIMITS.duplicates),
  questions: z.array(zAnalysisText(IDEA_ANALYSIS_LIMITS.question)).max(IDEA_ANALYSIS_LIMITS.questions),
});
export type IdeaAnalysisContent = z.infer<typeof zIdeaAnalysisContent>;

/** Where the last analysis of an Idée stands: running, passed, its Contrat incomplete, or its Session failed. */
export const IDEA_ANALYSIS_STATUSES = ['running', 'passed', 'incomplete', 'failed'] as const;
export const zIdeaAnalysisStatus = z.enum(IDEA_ANALYSIS_STATUSES);
export type IdeaAnalysisStatus = z.infer<typeof zIdeaAnalysisStatus>;

/**
 * The last `idea-analysis` StepRun of an Idée (US-48), as its page shows it:
 * the Rôle and Moteur that ran it (« Rôle Idée · Claude Code · il y a
 * 4 min »), when it started or ended (`at`), and, when its Contrat was
 * incomplete, the failed rules' ids (the page reads their labels with
 * `contratLabel`). Ids and codes only.
 */
export const zIdeaAnalysisRun = z.object({
  stepRunId: zId,
  status: zIdeaAnalysisStatus,
  role: zRoleId,
  engine: zEngineId.nullable(),
  at: zInstant,
  contractId: z.string().min(1).nullable(),
  contractVersion: z.int().positive().nullable(),
  failedRuleIds: z.array(z.string().min(1)),
});
export type IdeaAnalysisRun = z.infer<typeof zIdeaAnalysisRun>;

/**
 * An Idée (US-5): a sentence the Pilote noted, sealed in their browser
 * (ADR 0003): the server stores its ciphertext and never reads it. `number`
 * is its `#<n>`, one sequence per Pilote. `projectId` is the Projet the
 * Pilote chose, `targetProjectId` the one the analysis proposes
 * (`targetIsNew` when it proposes a new one). The payload of
 * `idea.upserted`, an item of the `ideas` slice and of `GET /api/ideas`.
 */
export const zIdea = z.object({
  id: zId,
  number: z.int().positive(),
  projectId: zId.nullable(),
  targetProjectId: zId.nullable(),
  targetIsNew: z.boolean(),
  state: zIdeaState,
  text: zSealedItem,
  analysis: zSealedItem.nullable(),
  impact: zIdeaRating.nullable(),
  effort: zIdeaRating.nullable(),
  duplicateIds: z.array(zId),
  notedFrom: zIdeaNotedFrom,
  dictated: z.boolean(),
  mergedIntoId: zId.nullable(),
  reason: zSealedItem.nullable(),
  ticketNumber: z.int().positive().nullable(),
  createdAt: zInstant,
  updatedAt: zInstant,
  analysedAt: zInstant.nullable(),
  triagedAt: zInstant.nullable(),
  /** Its last analysis, `null` when its Process has none (an Idée to triage without analysis). */
  analysisRun: zIdeaAnalysisRun.nullable(),
});
export type Idea = z.infer<typeof zIdea>;

/**
 * `POST /api/ideas` (session): an Idée noted, `to-triage`. The page draws its
 * `id` (a UUIDv7) to seal the text under `ideaItemAad(id, 'text')` before it
 * exists; an id already taken is 409. `seq` is the chosen Projet's, the last
 * the page saw (409 `realtime.stale` when it changed since).
 * `vaultKeyVersion` is the version of the vault key the text was sealed
 * under: 409 `vault.version-changed` once the vault rotated past it (E2E-4).
 */
export const zNoteIdeaInput = withSeq(
  z.object({
    id: zId,
    text: zIdeaText,
    vaultKeyVersion: zVaultKeyVersion,
    projectId: zId.nullable(),
    notedFrom: zIdeaNotedFrom,
    dictated: z.boolean(),
  }),
);
export type NoteIdeaInput = z.infer<typeof zNoteIdeaInput>;

/** `?states=` as the query string carries it: one value, or several separated by commas. */
const zStatesParam = z.preprocess(
  (value) => (typeof value === 'string' ? value.split(',').filter((part) => part.length > 0) : value),
  z.array(zIdeaState).min(1),
);

/**
 * `GET /api/ideas?states=merged,rejected&cursor=` (session): `states` is
 * mandatory (ADR 0008, « Lists »); a page of 50, the last updated first,
 * and the cursor of the next. The page reads with it the closed Idées older
 * than the `ideas` slice holds.
 */
export const zListIdeasQuery = z.object({ states: zStatesParam, cursor: z.string().min(1).optional() });
export type ListIdeasQuery = z.infer<typeof zListIdeasQuery>;

export const zIdeaList = zCursorPage(zIdea);
export type IdeaList = z.infer<typeof zIdeaList>;

/**
 * `POST /api/ideas/:id/target` (session, « Changer »): the Projet visé set by
 * the Pilote, `null` for « nouveau », without running the analysis again;
 * `seq` is the Idée's. 404 for a Projet of another Pilote, 422
 * `ideas.not-triageable` for an Idée merged or rejected.
 */
export const zSetIdeaTargetInput = withSeq(z.object({ projectId: zId.nullable() }));
export type SetIdeaTargetInput = z.infer<typeof zSetIdeaTargetInput>;

/**
 * `POST /api/ideas/:id/reanalyse` (session, « Relancer l'analyse »): the
 * last `idea-analysis` StepRun of the Idée run again, as the Décision's
 * rerun does; `seq` is the Idée's. 422 `ideas.analysis-running`,
 * `ideas.not-triageable`, `ideas.no-analysis-step`.
 */
export const zReanalyseIdeaInput = withSeq(z.object({}));
export type ReanalyseIdeaInput = z.infer<typeof zReanalyseIdeaInput>;
