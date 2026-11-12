import { z } from 'zod';
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

/**
 * « Runner et Comptes IA » (US-38, `/runner`): the Emplacement `usage` at the
 * top of the main column (the Comptes IA's usage, RUNNER-13), the card
 * « Moteurs et modèles » (each model of each Moteur, usable or why not), the
 * card « Connecter un Compte IA » with `command`, and, aside, the Runner card:
 * online, or offline since its last heartbeat, its machine, its system, its
 * version and the end-to-end encryption line. `runner` is `null` while none
 * is linked.
 */
export const PageRunner = defineComposant({
  name: 'PageRunner',
  version: 1,
  tag: 'cd-page-runner',
  category: 'page',
  description: 'Le Runner et les Comptes IA : ce que chaque Moteur peut faire tourner, la connexion, la machine.',
  data: z.object({
    engines: z.array(zEngineAccount),
    command: z.string().min(1),
    runner: zRunner.pick({ machine: true, os: true, arch: true, wsl: true, runnerVersion: true, state: true, lastSeenAt: true }).nullable(),
  }),
  actions: {},
  slots: ['usage'],
  examples: [
    { name: 'en ligne', data: { engines: [...EXAMPLE_ENGINES], command: 'crewdeck-runner login codex', runner: RUNNER } },
    {
      name: 'hors ligne',
      data: { engines: [...EXAMPLE_ENGINES], command: 'crewdeck-runner login codex', runner: { ...RUNNER, state: 'offline' } },
    },
  ],
});
