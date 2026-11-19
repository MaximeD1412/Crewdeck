import { Module } from '@nestjs/common';
import { DecisionsModule } from '../../decisions/decisions.module.js';
import { Engine } from './engine.js';
import { PhaseRunsState, StepRunsState } from './engine.state.js';
import { PHASE_ITEMS, PhaseItemHandlers } from './items.js';
import { STEP_KIND_HANDLERS, StepKindHandlers } from './kinds/handler.js';
import { PhaseRunsController } from './phase-runs.controller.js';

/**
 * The engine of the Process (PROCESS-4, ADR 0011): `Engine`, the registry of
 * the kinds' handlers (`STEP_KIND_HANDLERS`), and the `phaseRuns` and
 * `stepRuns` slices. An Étape's module imports it and adds its handler; the
 * modules whose items enter a Phase (the Boucle, the Conception, the Idée)
 * call `Engine.admit`, and add their item handler to `PHASE_ITEMS`. The
 * answers of « Maximum de Retours atteint » (PROCESS-6) are its routes.
 */
@Module({
  imports: [DecisionsModule],
  controllers: [PhaseRunsController],
  providers: [
    Engine,
    PhaseRunsState,
    StepRunsState,
    { provide: STEP_KIND_HANDLERS, useFactory: () => new StepKindHandlers() },
    { provide: PHASE_ITEMS, useFactory: () => new PhaseItemHandlers() },
  ],
  exports: [Engine, STEP_KIND_HANDLERS, PHASE_ITEMS],
})
export class EngineModule {}
