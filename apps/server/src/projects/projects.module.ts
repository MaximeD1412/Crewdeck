import { Module } from '@nestjs/common';
import { ProjectSources } from './project-sources.js';
import { ProjectState, Projects, ProjectsController } from './projects.js';

/** The Projets (PROJET-2): `/api/projects`, the `projects` slice, and which Source holds each group of a Projet. */
@Module({ controllers: [ProjectsController], providers: [Projects, ProjectState, ProjectSources], exports: [ProjectSources] })
export class ProjectsModule {}
