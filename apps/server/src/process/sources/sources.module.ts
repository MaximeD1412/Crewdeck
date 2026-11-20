import { Module } from '@nestjs/common';
import { DecisionsModule } from '../../decisions/decisions.module.js';
import { RunnersModule } from '../../runners/runners.module.js';
import { LocalMerges } from './local-merges.js';
import { SourcesService } from './sources.service.js';

/**
 * The Sources of a Projet (SOURCE-1, ADR 0012): `artifact_sources`, both
 * groups written at its creation. Exported for the Projets' creation
 * (PROJET-2, PROJET-6), the Process's view and activation (PROCESS-10), and
 * the migration of a group (SOURCE-7). The merges of a Local Projet's
 * changes of code (SOURCE-5), for the Boucle's `merge` and the approvals.
 */
@Module({ imports: [DecisionsModule, RunnersModule], providers: [SourcesService, LocalMerges], exports: [SourcesService, LocalMerges] })
export class SourcesModule {}
