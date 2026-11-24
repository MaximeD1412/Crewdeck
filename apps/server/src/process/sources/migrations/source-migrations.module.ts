import { Module } from '@nestjs/common';
import { RunnerTokens } from '../../../auth/runner-tokens.js';
import { DecisionsModule } from '../../../decisions/decisions.module.js';
import { RunnerTokenGuard } from '../../../devices/runner-token.guard.js';
import { ProjectsModule } from '../../../projects/projects.module.js';
import { RunnersModule } from '../../../runners/runners.module.js';
import { TicketsModule } from '../../../tickets/tickets.module.js';
import { EngineModule } from '../../engine/engine.module.js';
import { CodeSwitch } from './code.switch.js';
import { FinishSweep } from './finish-sweep.job.js';
import { RunnerSourceMigrationsController } from './runner-source-migrations.controller.js';
import { SourceMigrationGithubTokens } from './source-migration-github-token.js';
import { SourceMigrationsController } from './source-migrations.controller.js';
import { SourceMigrations } from './source-migrations.service.js';
import { SourceMigrationsState } from './source-migrations.state.js';
import { TicketsSwitch } from './tickets.switch.js';

/**
 * Moving a Type d'artefact to another Source (SOURCE-7, ADR 0012): the
 * Action sensible `source.migrate`, the draining, the switch and its
 * hooks (`SourceMigrations.registerSwitchHook`, for SOURCE-8 and
 * SOURCE-9), the Runner's `migration.*` messages, the finishes retried;
 * a switch tells `ProjectChanges` (the Runner's Miroir, MIROIR-6).
 */
@Module({
  imports: [DecisionsModule, EngineModule, RunnersModule, ProjectsModule, TicketsModule],
  controllers: [SourceMigrationsController, RunnerSourceMigrationsController],
  providers: [SourceMigrations, SourceMigrationsState, FinishSweep, TicketsSwitch, CodeSwitch, SourceMigrationGithubTokens, RunnerTokens, RunnerTokenGuard],
  exports: [SourceMigrations],
})
export class SourceMigrationsModule {}
