import { z } from 'zod';
import { zSha } from '../github/index.js';
import { zArtifactType } from '../process/artifact-types.js';
import { zStepKind } from '../process/catalogue.js';
import { zProcessId } from '../process/definition.js';
import { BUILTIN_TEMPLATES } from '../process/templates/process-crewdeck.js';
import { zId, zInstant } from '../values.js';

/**
 * The engine's runs (ADR 0011, « The engine »): a PhaseRun is one item
 * through one Phase, pinned to the version active when it started; a StepRun
 * is one pass of an Étape inside it. What they hold is readable by the
 * server (ADR 0003): ids, states, Artefact references, never content.
 */

/** `waiting`: on its turn or a Décision (`waitingOn`); the last three are final. */
export const PHASE_RUN_STATES = ['running', 'waiting', 'done', 'stopped', 'failed'] as const;
export const zPhaseRunState = z.enum(PHASE_RUN_STATES);
export type PhaseRunState = z.infer<typeof zPhaseRunState>;

/** What a `waiting` PhaseRun waits for: its turn in a Phase without `forEach` (PROCESS-5), a Décision (PROCESS-6). */
export const PHASE_RUN_WAITING_ON = ['queue', 'decision'] as const;
export const zPhaseRunWaitingOn = z.enum(PHASE_RUN_WAITING_ON);
export type PhaseRunWaitingOn = z.infer<typeof zPhaseRunWaitingOn>;

/**
 * `waiting`: on the Pilote (a gate); `interrupted`: its Session cut, the
 * Runner gone or a limit reached, to resume; `blocked`: its agent cannot go
 * on and says why, to unblock; `superseded`: undone by a rerun (a Retour's,
 * `rerunFrom`'s), its outputs feeding nothing any more.
 */
export const STEP_RUN_STATES = ['running', 'waiting', 'interrupted', 'blocked', 'done', 'failed', 'stopped', 'superseded'] as const;
export const zStepRunState = z.enum(STEP_RUN_STATES);
export type StepRunState = z.infer<typeof zStepRunState>;

/** A PhaseRun in these states is unfinished: `GET /api/state` lists it, the item cannot enter the Phase again. */
export const UNFINISHED_PHASE_RUN_STATES = ['running', 'waiting'] as const satisfies readonly PhaseRunState[];

/** A StepRun in these states holds its PhaseRun open. */
export const OPEN_STEP_RUN_STATES = ['running', 'waiting', 'interrupted', 'blocked'] as const satisfies readonly StepRunState[];

/** What an Étape that judges concludes: `changes` is what a Retour follows (PROCESS-6). */
export const STEP_VERDICTS = ['passed', 'changes', 'failed'] as const;
export const zStepRunVerdict = z.enum(STEP_VERDICTS);
export type StepRunVerdict = z.infer<typeof zStepRunVerdict>;

/**
 * An Artefact, by reference: the port it came out of (or the Entrée it fed,
 * for the item), its type, its `id` (an Idée's or a Ticket's id, a
 * document's path, a change's number) and, for what lives in git, its SHA.
 */
export const zArtifactRef = z.object({
  portId: zProcessId,
  type: zArtifactType,
  id: z.string().min(1).max(200),
  sha: zSha.optional(),
});
export type ArtifactRef = z.infer<typeof zArtifactRef>;

/** A code, never free text: `no-handler`, a handler's own (`checks-failed`). */
const zCode = z.string().min(1).max(60);

/** A definition of the release a PhaseRun without a Projet runs on: an Idée noted without one (US-5). */
export const zBuiltinTemplateId = z.enum(Object.keys(BUILTIN_TEMPLATES) as [keyof typeof BUILTIN_TEMPLATES, ...(keyof typeof BUILTIN_TEMPLATES)[]]);
export type BuiltinTemplateId = z.infer<typeof zBuiltinTemplateId>;

/**
 * A Retour of the PhaseRun's Phase as the PhaseRun took it: `taken` times so
 * far, and `extra` passes the Pilote allowed beyond its `max` (« Encore un
 * passage »). Listed once a Retour is taken; one never taken is not.
 */
export const zPhaseRunLoopBack = z.object({ from: zProcessId, to: zProcessId, taken: z.int().min(0), extra: z.int().min(0) });
export type PhaseRunLoopBack = z.infer<typeof zPhaseRunLoopBack>;

/**
 * One item through one Phase: `processVersion` is the number of the version
 * it is pinned to, `itemType` the type of its Phase's `forEach` (or of the
 * Artefact that started a Phase without one). Without a Projet, it runs on
 * `builtinTemplate`, with no version. `parentPhaseRunId` is its lineage: the
 * PhaseRun whose output became its item (a Ticket's Développement, its
 * Conception), `null` when none did; `loopBacks` what it took of its
 * Phase's Retours (PROCESS-6). The payload of `phase-run.upserted`, an
 * item of the `phaseRuns` slice while unfinished.
 */
export const zPhaseRun = z.object({
  id: zId,
  projectId: zId.nullable(),
  processVersion: z.int().min(1).nullable(),
  builtinTemplate: zBuiltinTemplateId.nullable(),
  parentPhaseRunId: zId.nullable(),
  phaseId: zProcessId,
  itemType: zArtifactType,
  itemId: z.string().min(1).max(200),
  state: zPhaseRunState,
  waitingOn: zPhaseRunWaitingOn.nullable(),
  loopBacks: z.array(zPhaseRunLoopBack).max(50),
  startedAt: zInstant,
  endedAt: zInstant.nullable(),
}).refine((run) => (run.projectId === null) === (run.builtinTemplate !== null) && (run.processVersion === null) === (run.builtinTemplate !== null), {
  message: 'A PhaseRun has a Projet and its version, or neither and a builtin definition.',
});
export type PhaseRun = z.infer<typeof zPhaseRun>;

/**
 * What fed one Entrée of a StepRun. `absent`: no Artefact reached it (an
 * arrow from another Phase whose Étape no ancestor ran); the Étape runs all
 * the same, its Skill and Contrat say what that means.
 */
export const zStepRunInput = z.object({ portId: zProcessId, artifacts: z.array(zArtifactRef), absent: z.boolean() });
export type StepRunInput = z.infer<typeof zStepRunInput>;

/**
 * One pass of an Étape in a PhaseRun: its kind, its `iteration` (1, then + 1
 * on each rerun), what fed its Entrées, what it gave on its Sorties, its
 * Verdict when it judges, why it failed (`failure`, a code), why a rerun
 * started it (`reason`: `loop-back`, or the caller's, `fix-conflict`), the
 * agent's Session when it has one, and whether it may ask for changes
 * (`canAskChanges`: its Étape judges and a Retour of its PhaseRun's version
 * leaves it; a gate hides its « Demander des changements » otherwise). The payload of `step-run.upserted`,
 * an item of the `stepRuns` slice while its PhaseRun is unfinished.
 */
export const zStepRun = z.object({
  id: zId,
  projectId: zId.nullable(),
  phaseRunId: zId,
  stepId: zProcessId,
  kind: zStepKind,
  iteration: z.int().min(1),
  state: zStepRunState,
  inputs: z.array(zStepRunInput),
  outputs: z.array(zArtifactRef),
  verdict: zStepRunVerdict.nullable(),
  failure: zCode.nullable(),
  reason: zCode.nullable(),
  sessionId: zId.nullable(),
  canAskChanges: z.boolean(),
  startedAt: zInstant,
  endedAt: zInstant.nullable(),
});
export type StepRun = z.infer<typeof zStepRun>;

/**
 * The body of `POST /api/phase-runs/:id/one-more-pass` and `…/stop`: the
 * Décision `loop-back.exhausted` they answer (PROCESS-6).
 */
export const zPhaseRunDecisionAnswer = z.object({ decisionId: zId });
export type PhaseRunDecisionAnswer = z.infer<typeof zPhaseRunDecisionAnswer>;

/**
 * The work in progress of each version: the `running` and `waiting`
 * PhaseRuns counted by the number of the version they are pinned to, in its
 * order; those without a version (no Projet) are no version's. The foot of
 * the panel and the activation's dialog (PROCESS-10).
 */
export const runningWorkByVersion = (phaseRuns: readonly Pick<PhaseRun, 'processVersion' | 'state'>[]): { version: number; count: number }[] => {
  const counts = new Map<number, number>();
  for (const run of phaseRuns) {
    if (run.processVersion === null || !(UNFINISHED_PHASE_RUN_STATES as readonly PhaseRunState[]).includes(run.state)) continue;
    counts.set(run.processVersion, (counts.get(run.processVersion) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a - b).map(([version, count]) => ({ version, count }));
};
