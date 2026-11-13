import { LINK_CODE_TTL_SECONDS } from '@crewdeck/contracts';
import { newId } from '../../ids.js';
import { createAiAccounts, createLinkedRunner } from '../runners.js';
import type { ScenarioContext } from './define.js';
import { CLAUDE_SIGNED_OUT, CLAUDE_SUBSCRIPTION, CODEX_SIGNED_OUT } from './engines.js';
import { defineScenario } from './define.js';
import { signInPilot } from './sign-in.js';

/**
 * The getting started's Runner step (`design/screens.json`: `demarrage`):
 * the Pilote signed in for the first time, no Runner; the page draws its code
 * and waits for the Runner.
 */
export const demarrage = defineScenario({
  name: 'demarrage',
  path: '/demarrage',
  seed: (ctx) => signInPilot(ctx, { gettingStartedStep: 'runner' }),
});

/**
 * The link failed (`demarrage`, state `liaison-echouee`): the Pilote's last
 * code expired a minute ago, before any Runner used it; the page shows its
 * halt Banner and a new command.
 */
export const demarrageLiaisonEchouee = defineScenario({
  name: 'demarrage-liaison-echouee',
  path: '/demarrage',
  seed: async (ctx) => {
    const seed = await signInPilot(ctx, { gettingStartedStep: 'runner' });
    const expiresAt = new Date(Date.now() - 60_000);
    await ctx.prisma.unscoped.runnerLinkCode.create({
      data: {
        id: newId(),
        pilotId: seed.pilotId,
        shortId: '7KQ4',
        state: 'expired',
        failureReason: 'expired',
        browserPairing: {},
        expiresAt,
        createdAt: new Date(expiresAt.getTime() - LINK_CODE_TTL_SECONDS * 1000),
      },
    });
    return seed;
  },
});

/**
 * The Runner linked (`demarrage`, state `runner-relie`): the Pilote still at
 * the Runner step, their Runner online (the fake Runner connects with its
 * token); « Continuer » goes on to the Comptes IA.
 */
export const demarrageRunnerRelie = defineScenario({
  name: 'demarrage-runner-relie',
  path: '/demarrage',
  seed: async (ctx) => {
    const seed = await signInPilot(ctx, { gettingStartedStep: 'runner' });
    const runnerMachine = { machine: 'atelier-pc', os: 'linux', arch: 'amd64', wsl: true, runnerVersion: '0.4.2' } as const;
    const { token } = await createLinkedRunner(ctx.prisma, seed.pilotId, runnerMachine);
    return { ...seed, runnerToken: token, runnerMachine };
  },
});

/** The Pilote at the Comptes IA step, their Runner online with `engines` reported. */
const atAiAccounts = async (ctx: ScenarioContext, engines: Parameters<typeof createAiAccounts>[2]) => {
  const seed = await signInPilot(ctx, { gettingStartedStep: 'ai-accounts' });
  const runnerMachine = { machine: 'atelier-pc', os: 'linux', arch: 'amd64', wsl: true, runnerVersion: '0.4.2' } as const;
  const { token } = await createLinkedRunner(ctx.prisma, seed.pilotId, runnerMachine);
  await createAiAccounts(ctx.prisma, seed.pilotId, engines);
  return { ...seed, runnerToken: token, runnerMachine };
};

/**
 * The Comptes IA step (`demarrage`, state `comptes-ia`): Claude Code
 * connected by subscription, two models usable and one outside the plan;
 * Codex without its key. « Continuer » is enabled.
 */
export const demarrageComptesIa = defineScenario({
  name: 'demarrage-comptes-ia',
  path: '/demarrage',
  seed: (ctx) => atAiAccounts(ctx, [CLAUDE_SUBSCRIPTION, CODEX_SIGNED_OUT]),
});

/**
 * No Moteur usable (`demarrage`, state `comptes-ia-aucun`): both signed out;
 * the caution Banner, both commands, « Continuer » disabled until the Runner
 * reports a usable model (`POST /api/testing/runner/capabilities`).
 */
export const demarrageComptesIaAucun = defineScenario({
  name: 'demarrage-comptes-ia-aucun',
  path: '/demarrage',
  seed: (ctx) => atAiAccounts(ctx, [CLAUDE_SIGNED_OUT, CODEX_SIGNED_OUT]),
});
