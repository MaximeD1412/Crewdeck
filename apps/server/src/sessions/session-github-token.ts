import { SESSION_TOKEN_PERMISSIONS, type SessionGithubToken } from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github/github.client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * A Session's GitHub token (RUNNER-10, ADR 0002, risk SEC-6): an
 * installation token restricted to its Projet's repository and to
 * `SESSION_TOKEN_PERMISSIONS`, 1 h, asked of GitHub at each request. It is
 * never stored, and never logged: the reply's body is not in the request's
 * log, and nothing here logs it.
 */
@Injectable()
export class SessionGithubTokens {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
  ) {}

  /**
   * The token of the Pilote's Session `id`: `sessions.not-found` for none,
   * `sessions.ended` once ended, `sessions.no-repository` when its Projet has
   * no repository it still reaches (a Local one, or its access lost).
   */
  async issue(id: string): Promise<SessionGithubToken> {
    const session = await this.prisma.scoped.agentSession.findUnique({ where: { id }, select: { state: true, projectId: true } });
    if (!session) throw notFound('sessions.not-found', MESSAGES['sessions.not-found']);
    if (session.state === 'ended') throw unprocessable('sessions.ended', MESSAGES['sessions.ended']);
    const project = await this.prisma.scoped.project.findUnique({
      where: { id: session.projectId },
      select: { repositoryId: true, githubRepoId: true, accessLost: true },
    });
    const repository =
      project?.repositoryId && project.githubRepoId !== null && !project.accessLost
        ? await this.prisma.scoped.repository.findUnique({ where: { id: project.repositoryId }, select: { installationId: true } })
        : null;
    if (!project?.githubRepoId || !repository) throw unprocessable('sessions.no-repository', MESSAGES['sessions.no-repository']);
    const { token, expiresAt } = await this.github.installationToken(Number(repository.installationId), {
      repositoryIds: [Number(project.githubRepoId)],
      permissions: SESSION_TOKEN_PERMISSIONS,
    });
    return { token, expiresAt };
  }
}
