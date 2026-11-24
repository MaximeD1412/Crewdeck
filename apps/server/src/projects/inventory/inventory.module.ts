import { Module } from '@nestjs/common';
import { DecisionsModule } from '../../decisions/decisions.module.js';
import { EngineModule } from '../../process/engine/engine.module.js';
import { AgentStepsModule } from '../../process/engine/kinds/agent.module.js';
import { RunnersModule } from '../../runners/runners.module.js';
import { SettingsModule } from '../../settings/settings.module.js';
import { ProjectsModule } from '../projects.module.js';
import { InventoryBoot } from './inventory.boot.js';
import { InventoryService } from './inventory.service.js';

/**
 * The Inventaire of an existing code (PROJET-4): the Étape « Inventaire »'s
 * handler, its report, its end, and when it starts (`InventoryService`), at
 * boot too (`InventoryBoot`).
 */
@Module({
  imports: [ProjectsModule, EngineModule, AgentStepsModule, DecisionsModule, SettingsModule, RunnersModule],
  providers: [InventoryService, InventoryBoot],
  exports: [InventoryService],
})
export class InventoryModule {}
