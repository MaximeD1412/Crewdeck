import { MIRROR_TOKEN_PERMISSIONS, type MirrorInstallationToken, type MirrorProject } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../../errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';
import type { OutgoingRunnerMessage } from '../../runners/runner-connections.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github.client.js';
import { mirrorProjectsOf } from './mirror-projects.js';

/** The answer to a `mirror.token`: every installation's token, or the failure of one. */
export type MirrorTokenAnswer = Extract<OutgoingRunnerMessage, { type: 'mirror.token.issued' | 'mirror.token.failed' }>;

/** The Projets of one installation: their repositories' ids (what the token is restricted to) and names. */
interface InstallationRepositories {
  readonly installationId: number;
  readonly repositoryIds: number[];
  readonly repositories: string[];
}

const byInstallation = (projects: readonly MirrorProject[]): InstallationRepositories[] => {
  const groups = new Map<number, InstallationRepositories>();
  for (const project of projects) {
    const group = groups.get(project.installationId) ?? { installationId: project.installationId, repositoryIds: [], repositories: [] };
    group.repositoryIds.push(project.githubRepoId);
    group.repositories.push(project.repository);
    groups.set(project.installationId, group);
  }
  return [...groups.values()];
};

/** Thrown by a token's request: which installation failed, and GitHub's code (never the error itself: it may carry a credential). */
class TokenRefused extends Error {
  constructor(
    readonly installationId: number,
    readonly code: string,
  ) {
    super(`The « Miroir » token of installation ${installationId} was refused.`);
  }
}

/**
 * The « Miroir » tokens of `projects` (ADR 0010, risk SEC-6): one
 * installation token per installation, restricted to the repositories of its
 * Projets and to `MIRROR_TOKEN_PERMISSIONS`, read only, 1 h. One installation
 * refused is `mirror.token.failed` for the whole request: the Runner asks
 * again. No Projet, no call to GitHub: `tokens: []`.
 */
export const mirrorTokens = async (
  github: GitHubClient,
  projects: readonly MirrorProject[],
  onRefused: (installationId: number, code: string) => void = () => undefined,
): Promise<MirrorTokenAnswer> => {
  try {
    const tokens = await Promise.all(
      byInstallation(projects).map(async ({ installationId, repositoryIds, repositories }): Promise<MirrorInstallationToken> => {
        try {
          const { token, expiresAt } = await github.installationToken(installationId, { repositoryIds, permissions: MIRROR_TOKEN_PERMISSIONS });
          return { installationId, token, expiresAt, repositories };
        } catch (error) {
          throw new TokenRefused(installationId, error instanceof AppError ? error.code : 'github.unavailable');
        }
      }),
    );
    return { type: 'mirror.token.issued', tokens };
  } catch (error) {
    if (!(error instanceof TokenRefused)) throw error;
    onRefused(error.installationId, error.code);
    return { type: 'mirror.token.failed', code: 'github.unavailable' };
  }
};

/**
 * Answers the Runner's `mirror.token` (MIROIR-2) with the « Miroir » tokens of
 * its Pilote's Projets, as `mirror.projects` lists them. The tokens are never
 * stored nor logged: the exchange is logged by its type and size (the
 * gateway), and here by its count of installations.
 */
@Injectable()
export class MirrorTokens implements OnModuleInit {
  constructor(
    private readonly dispatcher: RunnerDispatcher,
    private readonly prisma: PrismaService,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    @InjectPinoLogger(MirrorTokens.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('mirror.token', async (_, context) => {
      const answer = await mirrorTokens(this.github, await mirrorProjectsOf(this.prisma.scoped), (installationId, code) =>
        this.logger.warn({ runnerId: context.runnerId, installationId, code }, 'mirror token refused'),
      );
      if (answer.type === 'mirror.token.issued') this.logger.info({ runnerId: context.runnerId, installations: answer.tokens.length }, 'mirror tokens issued');
      context.reply(answer);
    });
  }
}
