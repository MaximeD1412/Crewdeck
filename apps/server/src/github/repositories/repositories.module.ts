import { Module } from '@nestjs/common';
import { Repositories, RepositoryState } from './repositories.js';
import { GitHubSetupController } from './setup.controller.js';

/** The Dépôts GitHub (PROJET-2): kept from the webhooks and the reconciliation, and the App's Setup URL. */
@Module({ controllers: [GitHubSetupController], providers: [Repositories, RepositoryState] })
export class RepositoriesModule {}
