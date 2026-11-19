import { Module } from '@nestjs/common';
import { RunnersModule } from '../../runners/runners.module.js';
import { SettingsModule } from '../../settings/settings.module.js';
import { ProjectsModule } from '../projects.module.js';
import { ReadinessController } from './readiness.controller.js';
import { ReadinessService } from './readiness.service.js';

/**
 * The readiness of the Projets (PROJET-3): its computation on its triggers
 * and the fixes of its checks. Its own module: it reads the Rôles of
 * `SettingsModule`, which imports `ProjectsModule`.
 */
@Module({
  imports: [ProjectsModule, SettingsModule, RunnersModule],
  controllers: [ReadinessController],
  providers: [ReadinessService],
  exports: [ReadinessService],
})
export class ReadinessModule {}
