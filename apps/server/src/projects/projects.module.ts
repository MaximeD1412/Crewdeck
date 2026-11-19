import { Module } from '@nestjs/common';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { ProcessModule } from '../process/process.module.js';
import { SourcesModule } from '../process/sources/sources.module.js';
import { RunnersModule } from '../runners/runners.module.js';
import { FolderRelay } from './local/folder-relay.js';
import { LocalProjects, LocalProjectsController } from './local/local-projects.js';
import { ProjectFolders } from './local/project-folders.js';
import { ProjectChanges } from './project-changes.js';
import { ProjectSources } from './project-sources.js';
import { ProjectState, Projects, ProjectsController } from './projects.js';

/**
 * The Projets (PROJET-2): `/api/projects`, the `projects` slice, which Source
 * holds each group of a Projet, and who learns that the Projets changed; each
 * new one gets its Process (PROCESS-3). A Local Projet (PROJET-6): its
 * creation, its folder through the relay and what the Runner says of it.
 */
@Module({
  imports: [ProcessModule, SourcesModule, RunnersModule, DecisionsModule],
  controllers: [ProjectsController, LocalProjectsController],
  providers: [Projects, ProjectState, ProjectSources, ProjectChanges, LocalProjects, ProjectFolders, FolderRelay],
  exports: [ProjectSources, ProjectChanges],
})
export class ProjectsModule {}
