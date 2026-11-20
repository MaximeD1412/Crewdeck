import { Module } from '@nestjs/common';
import { DecisionsModule } from '../../../decisions/decisions.module.js';
import { RunnersModule } from '../../../runners/runners.module.js';
import { SessionsModule } from '../../../sessions/sessions.module.js';
import { SettingsModule } from '../../../settings/settings.module.js';
import { EngineModule } from '../engine.module.js';
import { StepDecisions } from '../step-decisions.js';
import { AgentSteps } from './agent.js';
import { StepRunHooks } from './step-run-hooks.js';

/**
 * The agent Étapes (RUNNER-12): `AgentSteps`, whose `defineAgentKind` gives
 * each agent kind its handler, the Runner's `step.*` messages, the
 * `step-runs` work of « Runner hors ligne », `StepRunHooks`, and the
 * Décisions « Contrat incomplet » and « Étape échouée » (`StepDecisions`). An Étape's
 * module imports it with `EngineModule`, and adds its kind's handler.
 */
@Module({
  imports: [EngineModule, DecisionsModule, SessionsModule, SettingsModule, RunnersModule],
  providers: [AgentSteps, StepRunHooks, StepDecisions],
  exports: [AgentSteps, StepRunHooks],
})
export class AgentStepsModule {}
