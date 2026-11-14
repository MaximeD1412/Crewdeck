import { createAiAccounts, createLinkedRunner, createMcpServers } from '../runners.js';
import { defineScenario, type ScenarioContext } from './define.js';
import { CLAUDE_SUBSCRIPTION, CODEX_API_KEY } from './engines.js';
import { signInPilot } from './sign-in.js';

const RUNNER_MACHINE = { machine: 'atelier-pc', os: 'linux', arch: 'amd64', wsl: true, runnerVersion: '0.4.2' } as const;

/** The Runner's last heartbeat in the mockup « hors ligne »: 14:02 in Paris. */
const LAST_SEEN_AT = new Date('2026-11-11T13:02:00.000Z');

/** A Pilote past the getting started, both Comptes IA connected (Claude by subscription, Codex by API key). */
const withAccounts = async (ctx: ScenarioContext, lastSeenAt?: Date) => {
  const seed = await signInPilot(ctx);
  const { token } = await createLinkedRunner(ctx.prisma, seed.pilotId, { ...RUNNER_MACHINE, ...(lastSeenAt ? { lastSeenAt } : {}) });
  await createAiAccounts(ctx.prisma, seed.pilotId, [CLAUDE_SUBSCRIPTION, CODEX_API_KEY], lastSeenAt);
  return { ...seed, token };
};

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
    return { ...seed, runnerToken: token, runnerMachine: RUNNER_MACHINE };
  },
});

/** The Runner offline (`runner`, state `hors-ligne`) since its last heartbeat, at 14:02; the Comptes IA as it last reported them. */
export const runnerHorsLigne = defineScenario({
  name: 'runner-hors-ligne',
  path: '/runner',
  seed: async (ctx) => {
    const { token: _token, ...seed } = await withAccounts(ctx, LAST_SEEN_AT);
    return seed;
  },
});

/**
 * « Runner et Comptes IA » with two Serveurs MCP declared on the Runner
 * (`design/screens.json`: `runner-serveurs-mcp`): the `runner` scenario, plus
 * `stitch` (stdio, 12 outils) and `figma` (HTTP, 4 outils), both tested.
 */
export const runnerServeursMcp = defineScenario({
  name: 'runner-serveurs-mcp',
  path: '/runner',
  seed: async (ctx) => {
    const { token, ...seed } = await withAccounts(ctx);
    await createMcpServers(ctx.prisma, seed.pilotId, [
      { name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 12 },
      { name: 'figma', transport: 'http', state: 'ready', toolCount: 4 },
    ]);
    return { ...seed, runnerToken: token, runnerMachine: RUNNER_MACHINE };
  },
});
