import { createAiAccounts, createLinkedRunner } from '../runners.js';
import { defineScenario, type ScenarioContext } from './define.js';
import { CLAUDE_SUBSCRIPTION, CODEX_API_KEY } from './engines.js';
import { signInPilot } from './sign-in.js';
import { seedUsage } from './usage.js';

const RUNNER_MACHINE = { machine: 'atelier-pc', os: 'linux', arch: 'amd64', wsl: true, runnerVersion: '0.4.2' } as const;

/** The Runner's last heartbeat in the mockup « hors ligne »: 14:02 in Paris. */
const LAST_SEEN_AT = new Date('2026-11-11T13:02:00.000Z');

/**
 * A Pilote past the getting started, both Comptes IA connected (Claude by
 * subscription, Codex by API key), and their usage (RUNNER-13): measured up to
 * now, or up to `lastSeenAt` when the Runner went offline then.
 */
export const withAccounts = async (ctx: ScenarioContext, lastSeenAt?: Date) => {
  const seed = await signInPilot(ctx);
  const { token } = await createLinkedRunner(ctx.prisma, seed.pilotId, { ...RUNNER_MACHINE, ...(lastSeenAt ? { lastSeenAt } : {}) });
  await createAiAccounts(ctx.prisma, seed.pilotId, [CLAUDE_SUBSCRIPTION, CODEX_API_KEY], lastSeenAt);
  await seedUsage(ctx, seed.pilotId, lastSeenAt ? { lastMeasureAt: lastSeenAt } : {});
  return { ...seed, token, runnerMachine: RUNNER_MACHINE };
};

export { LAST_SEEN_AT };

/**
 * « Runner et Comptes IA » (`design/screens.json`: `runner`): the Runner
 * online (the fake Runner connects with its token), every model of both
 * Moteurs, usable or why not.
 */
export const runner = defineScenario({
  name: 'runner',
  path: '/runner',
  seed: async (ctx) => {
    const { token, ...seed } = await withAccounts(ctx);
    return { ...seed, runnerToken: token };
  },
});

/** The Runner offline (`runner`, state `hors-ligne`) since its last heartbeat, at 14:02; the Comptes IA as it last reported them. */
export const runnerHorsLigne = defineScenario({
  name: 'runner-hors-ligne',
  path: '/runner',
  seed: async (ctx) => {
    const { token: _token, runnerMachine: _machine, ...seed } = await withAccounts(ctx, LAST_SEEN_AT);
    return seed;
  },
});
