import { Module } from '@nestjs/common';
import { DecisionsModule } from '../../../decisions/decisions.module.js';
import { RunnersModule } from '../../../runners/runners.module.js';
import { EngineModule } from '../../engine/engine.module.js';
import { FinishSweep } from './finish-sweep.job.js';
import { SourceMigrationsController } from './source-migrations.controller.js';
import { SourceMigrations } from './source-migrations.service.js';
import { SourceMigrationsState } from './source-migrations.state.js';

/**
 * Moving a Type d'artefact to another Source (SOURCE-7, ADR 0012): the
 * Action sensible `source.migrate`, the draining, the switch and its
 * hooks (`SourceMigrations.registerSwitchHook`, for SOURCE-8 and
 * SOURCE-9), the Runner's `migration.*` messages, the finishes retried.
 */
@Module({
  imports: [DecisionsModule, EngineModule, RunnersModule],
  controllers: [SourceMigrationsController],
  providers: [SourceMigrations, SourceMigrationsState, FinishSweep],
  exports: [SourceMigrations],
})
export class SourceMigrationsModule {}
