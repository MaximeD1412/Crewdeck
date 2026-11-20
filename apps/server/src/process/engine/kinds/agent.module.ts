import { Module } from '@nestjs/common';
import { RunnersModule } from '../../../runners/runners.module.js';
import { SessionsModule } from '../../../sessions/sessions.module.js';
import { SettingsModule } from '../../../settings/settings.module.js';
import { EngineModule } from '../engine.module.js';
import { AgentSteps } from './agent.js';
import { StepRunHooks } from './step-run-hooks.js';

/**
 * The agent Étapes (RUNNER-12): `AgentSteps`, whose `defineAgentKind` gives
 * each agent kind its handler, the Runner's `step.*` messages, the
 * `step-runs` work of « Runner hors ligne », and `StepRunHooks`. An Étape's
 * module imports it with `EngineModule`, and adds its kind's handler.
 */
@Module({
  imports: [EngineModule, SessionsModule, SettingsModule, RunnersModule],
  providers: [AgentSteps, StepRunHooks],
  exports: [AgentSteps, StepRunHooks],
})
export class AgentStepsModule {}
