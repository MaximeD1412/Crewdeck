import { Module } from '@nestjs/common';
import { ProjectChanges } from './project-changes.js';
import { ProjectSources } from './project-sources.js';
import { ProjectState, Projects, ProjectsController } from './projects.js';

/**
 * The Projets (PROJET-2): `/api/projects`, the `projects` slice, which Source
 * holds each group of a Projet, and who learns that the Projets changed.
 */
@Module({ controllers: [ProjectsController], providers: [Projects, ProjectState, ProjectSources, ProjectChanges], exports: [ProjectSources, ProjectChanges] })
export class ProjectsModule {}
