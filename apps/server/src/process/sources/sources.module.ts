import { Module } from '@nestjs/common';
import { SourcesService } from './sources.service.js';

/**
 * The Sources of a Projet (SOURCE-1, ADR 0012): `artifact_sources`, both
 * groups written at its creation. Exported for the Projets' creation
 * (PROJET-2, PROJET-6), the Process's view and activation (PROCESS-10), and
 * the migration of a group (SOURCE-7).
 */
@Module({ providers: [SourcesService], exports: [SourcesService] })
export class SourcesModule {}
