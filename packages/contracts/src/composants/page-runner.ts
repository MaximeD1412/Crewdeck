import { z } from 'zod';
import { zMcpServer } from '../api/mcp-servers.js';
import { zRunner } from '../api/runner.js';
import { defineComposant } from './define.js';
import { EXAMPLE_ENGINES, zEngineAccount } from './engine-account.js';

const RUNNER = {
  machine: 'atelier-pc',
  os: 'linux',
  arch: 'amd64',
  wsl: true,
  runnerVersion: '0.4.2',
  state: 'online',
  lastSeenAt: '2026-11-11T14:12:00.000Z',
} as const;

const MCP_SERVERS = [
  { name: 'figma', transport: 'http', state: 'ready', toolCount: 4 },
  { name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 12 },
] as const;

/**
 * « Runner et Comptes IA » (US-38, `/runner`): first in the main column, the
 * card « Serveurs MCP » (each server declared on the Runner, its transport,
 * its tool count and whether its last test passed, US-73) and the card
 * « Déclarer un Serveur MCP » (the command, on the machine); then the
 * Emplacement `usage` (the Comptes IA's usage, RUNNER-13), the card
 * « Moteurs et modèles » (each model of each Moteur, usable or why not), the
 * card « Connecter un Compte IA » with `command`, and, aside, the Runner card:
 * online, or offline since its last heartbeat, its machine, its system, its
 * version and the end-to-end encryption line. `runner` is `null` while none
 * is linked.
 */
export const PageRunner = defineComposant({
  name: 'PageRunner',
  version: 2,
  tag: 'cd-page-runner',
  category: 'page',
  description: 'Le Runner et les Comptes IA : ce que chaque Moteur peut faire tourner, la connexion, la machine.',
  data: z.object({
    engines: z.array(zEngineAccount),
    command: z.string().min(1),
    runner: zRunner.pick({ machine: true, os: true, arch: true, wsl: true, runnerVersion: true, state: true, lastSeenAt: true }).nullable(),
    /** As the Runner last reported them, by name: still shown while it is offline. */
    mcpServers: z.array(zMcpServer.pick({ name: true, transport: true, state: true, toolCount: true })),
  }),
  actions: {},
  slots: ['usage'],
  examples: [
    { name: 'en ligne', data: { engines: [...EXAMPLE_ENGINES], command: 'crewdeck-runner login codex', runner: RUNNER, mcpServers: [...MCP_SERVERS] } },
    {
      name: 'hors ligne',
      data: { engines: [...EXAMPLE_ENGINES], command: 'crewdeck-runner login codex', runner: { ...RUNNER, state: 'offline' }, mcpServers: [...MCP_SERVERS] },
    },
    { name: 'aucun Serveur MCP', data: { engines: [...EXAMPLE_ENGINES], command: 'crewdeck-runner login codex', runner: RUNNER, mcpServers: [] } },
  ],
});
