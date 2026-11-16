import { type PhaseRun, type StepRun, UNFINISHED_PHASE_RUN_STATES } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../../realtime/state-contributors.js';
import type { Tx } from '../../realtime/transactions.js';
import { PHASE_RUN_VIEW, STEP_RUN_VIEW, toPhaseRun, toStepRun } from './engine.view.js';

const UNFINISHED = [...UNFINISHED_PHASE_RUN_STATES];

/** The `phaseRuns` slice: every unfinished PhaseRun (`running` or `waiting`) of every Projet, the oldest first. */
@Injectable()
export class PhaseRunsState implements StateContributor<'phaseRuns'>, OnModuleInit {
  readonly key = 'phaseRuns';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<PhaseRun[]> {
    const rows = await tx.phaseRun.findMany({ where: { state: { in: UNFINISHED } }, select: PHASE_RUN_VIEW, orderBy: { id: 'asc' } });
    return rows.map(toPhaseRun);
  }
}

/** The `stepRuns` slice: every StepRun of the unfinished PhaseRuns, `superseded` ones included, in the order they were created. */
@Injectable()
export class StepRunsState implements StateContributor<'stepRuns'>, OnModuleInit {
  readonly key = 'stepRuns';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<StepRun[]> {
    const unfinished = await tx.phaseRun.findMany({ where: { state: { in: UNFINISHED } }, select: { id: true } });
    if (unfinished.length === 0) return [];
    const rows = await tx.stepRun.findMany({ where: { phaseRunId: { in: unfinished.map(({ id }) => id) } }, select: STEP_RUN_VIEW, orderBy: { id: 'asc' } });
    return rows.map(toStepRun);
  }
}
