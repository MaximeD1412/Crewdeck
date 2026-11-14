import { Module } from '@nestjs/common';
import { ProjectState, Projects, ProjectsController } from './projects.js';

/** The Projets (PROJET-2): `/api/projects` and the `projects` slice. */
@Module({ controllers: [ProjectsController], providers: [Projects, ProjectState] })
export class ProjectsModule {}
