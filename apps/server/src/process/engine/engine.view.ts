import { type PhaseRun, type StepRun, zArtifactRef, zArtifactType, zPhaseRunWaitingOn, zStepKind, zStepRunInput } from '@crewdeck/contracts';
import { z } from 'zod';
import type { PhaseRunState, StepRunState, StepVerdict } from '../../generated/prisma/client.js';

/** What of a `phase_runs` row the view reads: the number of the version it is pinned to included. */
export const PHASE_RUN_VIEW = {
  id: true,
  projectId: true,
  processVersionId: true,
  phaseId: true,
  itemType: true,
  itemId: true,
  state: true,
  waitingOn: true,
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
  readonly projectId: string;
  readonly processVersionId: string;
  readonly phaseId: string;
  readonly itemType: string;
  readonly itemId: string;
  readonly state: PhaseRunState;
  readonly waitingOn: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  /** Not in the view: the engine's own (`Engine`'s pending starts). */
  readonly pendingStarts: unknown;
  readonly processVersion: { readonly number: number };
}

export interface StepRunRow {
  readonly id: string;
  readonly projectId: string;
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
  processVersion: row.processVersion.number,
  phaseId: row.phaseId,
  itemType: zArtifactType.parse(row.itemType),
  itemId: row.itemId,
  state: row.state,
  waitingOn: row.waitingOn === null ? null : zPhaseRunWaitingOn.parse(row.waitingOn),
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
});

export const toStepRun = (row: StepRunRow): StepRun => ({
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
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
});
