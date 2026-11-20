import { Module } from '@nestjs/common';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { EngineModule } from '../process/engine/engine.module.js';
import { AgentStepsModule } from '../process/engine/kinds/agent.module.js';
import { IdeaAnalysisKind } from '../process/engine/kinds/idea-analysis.js';
import { RunnersModule } from '../runners/runners.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { IdeaAnalysis } from './analysis.js';
import { IdeasController, IdeasState } from './ideas.controller.js';
import { IdeasService } from './ideas.service.js';

/**
 * The Idées (IDEE-1, IDEE-2): `POST /api/ideas`, `GET /api/ideas`, « Changer »
 * and « Relancer l'analyse », the `ideas` slice, the Décision
 * `ideas-to-triage`, and their analysis, the kind `idea-analysis`.
 */
@Module({
  imports: [DecisionsModule, EngineModule, AgentStepsModule, SettingsModule, RunnersModule],
  controllers: [IdeasController],
  providers: [IdeasService, IdeasState, IdeaAnalysis, IdeaAnalysisKind],
})
export class IdeasModule {}
