import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.js';
import { SettingsController, SettingsState } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/**
 * The Paramètres (PARAM-1, PARAM-2): `SettingsService.effective`, what every
 * module reads its settings with, `RolesService.check`, `/api/settings` and
 * `/api/roles`.
 */
@Module({ controllers: [SettingsController, RolesController], providers: [SettingsService, SettingsState, RolesService], exports: [SettingsService, RolesService] })
export class SettingsModule {}
