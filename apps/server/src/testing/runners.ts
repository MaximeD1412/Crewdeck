import type { EngineCapabilities, Runner } from '@crewdeck/contracts';
import { newRunnerToken, runnerTokenHash } from '../auth/runner-tokens.js';
import { newId } from '../ids.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { rowOf } from '../runners/ai-accounts/ai-account.view.js';
import { RUNNER_VIEW, toRunner } from '../runners/runner.view.js';

type RunnerFields = Partial<Pick<Runner, 'machine' | 'os' | 'arch' | 'wsl' | 'runnerVersion'>> & { readonly protocolVersion?: number; readonly lastSeenAt?: Date };

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
      lastSeenAt: fields.lastSeenAt ?? linkedAt,
      linkedAt,
    },
    select: RUNNER_VIEW,
  });
  return { runner: toRunner(row), token };
};

/**
 * The Comptes IA of `pilotId` as their Runner's last `capabilities` left them,
 * one row per Moteur of `engines` (reported at `reportedAt`). For the
 * scenarios: unscoped, as a seed, without events.
 */
export const createAiAccounts = async (
  prisma: PrismaService,
  pilotId: string,
  engines: readonly EngineCapabilities[],
  reportedAt = new Date(),
): Promise<void> => {
  await prisma.unscoped.aiAccount.createMany({ data: engines.map((engine) => ({ id: newId(), pilotId, ...rowOf(engine, reportedAt) })) });
};
