import {
  canAskChanges,
  type PhaseRun,
  type ProcessDefinition,
  type StepRun,
  zArtifactRef,
  zArtifactType,
  zBuiltinTemplateId,
  zPhaseRunLoopBack,
  zPhaseRunWaitingOn,
  zStepKind,
  zStepRunInput,
} from '@crewdeck/contracts';
import { z } from 'zod';
import type { PhaseRunState, StepRunState, StepVerdict } from '../../generated/prisma/client.js';

/** What of a `phase_runs` row the view reads: the number of the version it is pinned to included. */
export const PHASE_RUN_VIEW = {
  id: true,
  projectId: true,
  processVersionId: true,
  builtinTemplate: true,
  parentPhaseRunId: true,
  phaseId: true,
  itemType: true,
  itemId: true,
  state: true,
  waitingOn: true,
  loopBacks: true,
  startedAt: true,
  endedAt: true,
  pendingStarts: true,
  processVersion: { select: { number: true } },
} as const;

/** What of a `step_runs` row the view reads. */
export const STEP_RUN_VIEW = {
  id: true,
  projectId: true,
  phaseRunId: true,
  stepId: true,
  kind: true,
  iteration: true,
  state: true,
  inputs: true,
  outputs: true,
  verdict: true,
  failure: true,
  reason: true,
  sessionId: true,
  startedAt: true,
  endedAt: true,
} as const;

export interface PhaseRunRow {
  readonly id: string;
  readonly projectId: string | null;
  readonly processVersionId: string | null;
  readonly builtinTemplate: string | null;
  readonly parentPhaseRunId: string | null;
  readonly phaseId: string;
  readonly itemType: string;
  readonly itemId: string;
  readonly state: PhaseRunState;
  readonly waitingOn: string | null;
  readonly loopBacks: unknown;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  /** Not in the view: the engine's own (`Engine`'s pending starts). */
  readonly pendingStarts: unknown;
  readonly processVersion: { readonly number: number } | null;
}

export interface StepRunRow {
  readonly id: string;
  readonly projectId: string | null;
  readonly phaseRunId: string;
  readonly stepId: string;
  readonly kind: string;
  readonly iteration: number;
  readonly state: StepRunState;
  readonly inputs: unknown;
  readonly outputs: unknown;
  readonly verdict: StepVerdict | null;
  readonly failure: string | null;
  readonly reason: string | null;
  readonly sessionId: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export const toPhaseRun = (row: PhaseRunRow): PhaseRun => ({
  id: row.id,
  projectId: row.projectId,
  processVersion: row.processVersion?.number ?? null,
  builtinTemplate: row.builtinTemplate === null ? null : zBuiltinTemplateId.parse(row.builtinTemplate),
  parentPhaseRunId: row.parentPhaseRunId,
  phaseId: row.phaseId,
  itemType: zArtifactType.parse(row.itemType),
  itemId: row.itemId,
  state: row.state,
  waitingOn: row.waitingOn === null ? null : zPhaseRunWaitingOn.parse(row.waitingOn),
  loopBacks: z.array(zPhaseRunLoopBack).parse(row.loopBacks),
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
});

/** The StepRun as the contracts have it; `definition`, its PhaseRun's pinned one, says whether it may ask for changes. */
export const toStepRun = (row: StepRunRow, definition: ProcessDefinition): StepRun => ({
  id: row.id,
  projectId: row.projectId,
  phaseRunId: row.phaseRunId,
  stepId: row.stepId,
  kind: zStepKind.parse(row.kind),
  iteration: row.iteration,
  state: row.state,
  inputs: z.array(zStepRunInput).parse(row.inputs),
  outputs: z.array(zArtifactRef).parse(row.outputs),
  verdict: row.verdict,
  failure: row.failure,
  reason: row.reason,
  sessionId: row.sessionId,
  canAskChanges: canAskChanges(definition, row.stepId),
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
});
