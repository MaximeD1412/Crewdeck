import { SOURCE_MIGRATION_TOKEN_PERMISSIONS, type SourceMigrationGithubToken } from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { notFound, unprocessable } from '../../../errors/app-error.js';
import { MESSAGES } from '../../../errors/messages.js';
import { GITHUB_CLIENT, type GitHubClient } from '../../../github/github.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

/** The states in which the Runner copies, verifies or finishes, and so writes to GitHub. */
const RUNNING = ['copying', 'verifying', 'switched'] as const;

/**
 * A migration's GitHub token (SOURCE-8, ADR 0002): an installation token
 * restricted to its Projet's repository and to `issues: write`, 1 h, asked
 * of GitHub at each request, while the Runner copies, verifies or finishes.
 * Never stored, never logged.
 */
@Injectable()
export class SourceMigrationGithubTokens {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
  ) {}

  /**
   * The token of the Pilote's migration `id`: `source-migration.not-found`
   * for none, `source-migration.not-running` when it is not copying,
   * verifying nor switched, or its Projet reaches no repository.
   */
  async issue(id: string): Promise<SourceMigrationGithubToken> {
    const migration = await this.prisma.scoped.sourceMigration.findUnique({ where: { id }, select: { state: true, projectId: true } });
    if (!migration) throw notFound('source-migration.not-found', MESSAGES['source-migration.not-found']);
    const notRunning = () => unprocessable('source-migration.not-running', MESSAGES['source-migration.not-running']);
    if (!(RUNNING as readonly string[]).includes(migration.state)) throw notRunning();
    const project = await this.prisma.scoped.project.findUnique({
      where: { id: migration.projectId },
      select: { repositoryId: true, githubRepoId: true, accessLost: true },
    });
    const repository =
      project?.repositoryId && project.githubRepoId !== null && !project.accessLost
        ? await this.prisma.scoped.repository.findUnique({ where: { id: project.repositoryId }, select: { installationId: true } })
        : null;
    if (!project?.githubRepoId || !repository) throw notRunning();
    const { token, expiresAt } = await this.github.installationToken(Number(repository.installationId), {
      repositoryIds: [Number(project.githubRepoId)],
      permissions: SOURCE_MIGRATION_TOKEN_PERMISSIONS,
    });
    return { token, expiresAt };
  }
}
