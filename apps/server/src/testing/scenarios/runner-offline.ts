import type { WaitingProject } from '@crewdeck/contracts';
import { createLinkedRunner } from '../runners.js';
import { PROJECTS, seedDecisions } from './a-toi.js';
import { defineScenario, type ScenarioContext } from './define.js';
import { LAST_SEEN_AT, RUNNER_MACHINE, withAccounts } from './runner.js';

/**
 * The work that waits in the mockups (`a-toi-runner-hors-ligne`): #44 of
 * Crewdeck in progress, #53 of Personal OS in progress and 2 of its Tickets
 * ready, #47 of Site mairie interrupted.
 */
export const WAITING: readonly WaitingProject[] = [
  { projectId: PROJECTS.crewdeck.projectId, name: PROJECTS.crewdeck.projectName, items: [{ kind: 'ticket-in-progress', number: 44 }] },
  {
    projectId: PROJECTS.personalOs.projectId,
    name: PROJECTS.personalOs.projectName,
    items: [
      { kind: 'ticket-in-progress', number: 53 },
      { kind: 'tickets-ready', count: 2 },
    ],
  },
  { projectId: PROJECTS.siteMairie.projectId, name: PROJECTS.siteMairie.projectName, items: [{ kind: 'ticket-interrupted', number: 47 }] },
];

/** The Runner of `pilotId` offline since 14:02, the mockups' work waiting for it: « Runner hors ligne » raised as at its timeout. */
const goneOffline = async (ctx: ScenarioContext, pilotId: string): Promise<void> => {
  ctx.fakes.waitingWork.declare(pilotId, WAITING);
  await ctx.refreshRunnerOffline(pilotId);
};

/**
 * « À toi » with the Runner offline (`a-toi`, state `runner-hors-ligne`): the
 * nine Décisions of `a-toi`, and « Runner hors ligne » listing three Projets
 * with its banner.
 */
export const aToiRunnerHorsLigne = defineScenario({
  name: 'a-toi-runner-hors-ligne',
  path: '/a-toi',
  seed: async (ctx) => {
    const seed = await seedDecisions(ctx);
    await createLinkedRunner(ctx.prisma, seed.pilotId, { ...RUNNER_MACHINE, lastSeenAt: LAST_SEEN_AT });
    await goneOffline(ctx, seed.pilotId);
    return seed;
  },
});

/**
 * The Runner offline (`runner`, state `hors-ligne`) since its last heartbeat,
 * at 14:02; the Comptes IA as it last reported them; the banner « Rien ne
 * tourne » with the Projets whose work waits and the restart command.
 */
export const runnerHorsLigne = defineScenario({
  name: 'runner-hors-ligne',
  path: '/runner',
  seed: async (ctx) => {
    const { token: _token, ...seed } = await withAccounts(ctx, LAST_SEEN_AT);
    await goneOffline(ctx, seed.pilotId);
    return seed;
  },
});
