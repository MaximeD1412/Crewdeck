import { Module } from '@nestjs/common';
import { SettingsController, SettingsState } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/** The Paramètres (PARAM-1): `SettingsService.effective`, what every module reads its settings with, and `/api/settings`. */
@Module({ controllers: [SettingsController], providers: [SettingsService, SettingsState], exports: [SettingsService] })
export class SettingsModule {}
