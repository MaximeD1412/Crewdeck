import { Module } from '@nestjs/common';
import { Engine } from './engine.js';
import { PhaseRunsState, StepRunsState } from './engine.state.js';
import { STEP_KIND_HANDLERS, StepKindHandlers } from './kinds/handler.js';

/**
 * The engine of the Process (PROCESS-4, ADR 0011): `Engine`, the registry of
 * the kinds' handlers (`STEP_KIND_HANDLERS`), and the `phaseRuns` and
 * `stepRuns` slices. An Étape's module imports it and adds its handler; the
 * modules whose items enter a Phase (the Boucle, the Conception, the Idée)
 * call `Engine.admit`.
 */
@Module({
  providers: [Engine, PhaseRunsState, StepRunsState, { provide: STEP_KIND_HANDLERS, useFactory: () => new StepKindHandlers() }],
  exports: [Engine, STEP_KIND_HANDLERS],
})
export class EngineModule {}
