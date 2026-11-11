import type { Runner } from '@crewdeck/contracts';
import { newRunnerToken, runnerTokenHash } from '../auth/runner-tokens.js';
import { newId } from '../ids.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { RUNNER_VIEW, toRunner } from '../runners/runner.view.js';

type RunnerFields = Partial<Pick<Runner, 'machine' | 'os' | 'arch' | 'wsl' | 'runnerVersion'>> & { readonly protocolVersion?: number };

/**
 * A Runner linked to `pilotId`, as RUNNER-3's link will leave it: offline,
 * never seen since its link, and the token it was given (the server keeps
 * only its hash). For the tests and the scenarios: unscoped, as a seed.
 */
export const createLinkedRunner = async (
  prisma: PrismaService,
  pilotId: string,
  fields: RunnerFields = {},
): Promise<{ runner: Runner; token: string }> => {
  const token = newRunnerToken();
  const linkedAt = new Date();
  const row = await prisma.unscoped.runner.create({
    data: {
      id: newId(),
      pilotId,
      tokenHash: runnerTokenHash(token),
      machine: 'atelier',
      os: 'linux',
      arch: 'amd64',
      wsl: true,
      runnerVersion: '0.1.0',
      protocolVersion: 1,
      ...fields,
      state: 'offline',
      lastSeenAt: linkedAt,
      linkedAt,
    },
    select: RUNNER_VIEW,
  });
  return { runner: toRunner(row), token };
};
