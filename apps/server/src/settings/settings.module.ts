import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectSettingsController, ProjectSettingsService } from './project-settings.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.js';
import { SettingsController, SettingsState } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/**
 * The Paramètres (PARAM-1, PARAM-2, PARAM-3): `SettingsService.effective`,
 * what every module reads its settings with, `RolesService.check`,
 * `/api/settings`, `/api/roles` and `/api/projects/:id/settings`.
 */
@Module({
  imports: [ProjectsModule],
  controllers: [SettingsController, RolesController, ProjectSettingsController],
  providers: [SettingsService, SettingsState, RolesService, ProjectSettingsService],
  exports: [SettingsService, RolesService, ProjectSettingsService],
})
export class SettingsModule {}
