import { Module } from '@nestjs/common';
import { ProjectsModule } from '../../projects/projects.module.js';
import { Repositories, RepositoryState } from './repositories.js';
import { GitHubSetupController } from './setup.controller.js';

/** The Dépôts GitHub (PROJET-2): kept from the webhooks and the reconciliation, and the App's Setup URL. */
@Module({ imports: [ProjectsModule], controllers: [GitHubSetupController], providers: [Repositories, RepositoryState] })
export class RepositoriesModule {}
