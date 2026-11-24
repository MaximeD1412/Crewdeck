import { Module } from '@nestjs/common';
import { ProcessBackfill } from './process-backfill.js';
import { ProcessController } from './process.controller.js';
import { ProcessRoleUsage } from './process-role-usage.js';
import { ProcessService } from './process.service.js';
import { ProcessState } from './process.state.js';
import { ProcessTemplatesController, ProcessTemplatesState } from './templates/process-templates.controller.js';
import { ProcessTemplatesService } from './templates/process-templates.service.js';

/**
 * A Projet's Process (PROCESS-3, ADR 0011): its versions and its draft, the
 * routes, the `processes` slice, the Étapes naming a Rôle, and at start the
 * Sources a Projet lacks (SOURCE-1), then the Projets followed before it
 * given their version 1; the Pilote's Modèles de process (PROCESS-14). `ProjectsModule`
 * imports it: following a Projet writes its first version.
 */
@Module({
  controllers: [ProcessController, ProcessTemplatesController],
  providers: [ProcessService, ProcessState, ProcessRoleUsage, ProcessBackfill, ProcessTemplatesService, ProcessTemplatesState],
  exports: [ProcessService],
})
export class ProcessModule {}
