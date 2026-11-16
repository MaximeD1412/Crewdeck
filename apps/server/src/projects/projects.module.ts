import { Module } from '@nestjs/common';
import { ProcessModule } from '../process/process.module.js';
import { SourcesModule } from '../process/sources/sources.module.js';
import { ProjectChanges } from './project-changes.js';
import { ProjectSources } from './project-sources.js';
import { ProjectState, Projects, ProjectsController } from './projects.js';

/**
 * The Projets (PROJET-2): `/api/projects`, the `projects` slice, which Source
 * holds each group of a Projet, and who learns that the Projets changed; each
 * new one gets its Process (PROCESS-3).
 */
@Module({ imports: [ProcessModule, SourcesModule], controllers: [ProjectsController], providers: [Projects, ProjectState, ProjectSources, ProjectChanges], exports: [ProjectSources, ProjectChanges] })
export class ProjectsModule {}
