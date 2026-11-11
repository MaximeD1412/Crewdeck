import { z } from 'zod';
import { zGettingStartedStep } from '../api/me.js';
import { zLinkFailureReason } from '../api/runner-link.js';
import { zRunner } from '../api/runner.js';
import { defineComposant } from './define.js';

/** The systems of the install command's tabs: the same command, a help line each. */
export const DEMARRAGE_SYSTEMS = ['linux', 'macos', 'wsl'] as const;
export const zDemarrageSystem = z.enum(DEMARRAGE_SYSTEMS);
export type DemarrageSystem = z.infer<typeof zDemarrageSystem>;

const COMMAND = 'curl -fsSL https://crewdeck.example/runner/install.sh | sh -s -- --link 7KQ4-M2PXA7QK9VZ3T8W4R6N1B5C0DE';
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
 * « Premiers pas » (US-2, `/demarrage`), in the bare Cadre: the track of its
 * steps, then the step the Pilote is at. The Runner's step shows the install
 * command of the system's tab with the full link code, waiting for the
 * Runner (`shortId` only ever shown); after a failed link, the halt Banner of
 * its reason, the new command and « Réessayer » (`retry`); once linked, the
 * Runner's machine and « Continuer » (`continue`). The Comptes IA (RUNNER-7)
 * and the Projets (PROJET-2) show an Empty and « Continuer » until their
 * tickets. `command` is `null` until the page drew its code; `busy` while a
 * command is on its way.
 */
export const PageDemarrage = defineComposant({
  name: 'PageDemarrage',
  version: 1,
  tag: 'cd-page-demarrage',
  category: 'page',
  description: 'Les Premiers pas : le Runner, les Comptes IA, les Projets.',
  data: z.object({
    step: zGettingStartedStep.exclude(['done']),
    login: z.string(),
    system: zDemarrageSystem,
    command: z.string().nullable(),
    shortId: z.string().nullable(),
    failure: z.object({ reason: zLinkFailureReason, shortId: z.string() }).nullable(),
    runner: zRunner.pick({ machine: true, os: true, arch: true, wsl: true, runnerVersion: true, state: true, lastSeenAt: true }).nullable(),
    busy: z.boolean(),
  }),
  actions: { selectSystem: z.object({ system: zDemarrageSystem }), retry: z.object({}), continue: z.object({}) },
  slots: [],
  examples: [
    {
      name: 'en attente du Runner',
      data: { step: 'runner', login: 'octocat', system: 'linux', command: COMMAND, shortId: '7KQ4', failure: null, runner: null, busy: false },
    },
    {
      name: 'liaison échouée',
      data: {
        step: 'runner',
        login: 'octocat',
        system: 'linux',
        command: COMMAND,
        shortId: '7KQ4',
        failure: { reason: 'expired', shortId: '9RTB' },
        runner: null,
        busy: false,
      },
    },
    {
      name: 'Runner relié',
      data: { step: 'runner', login: 'octocat', system: 'wsl', command: null, shortId: null, failure: null, runner: RUNNER, busy: false },
    },
    {
      name: 'Comptes IA',
      data: { step: 'ai-accounts', login: 'octocat', system: 'linux', command: null, shortId: null, failure: null, runner: RUNNER, busy: false },
    },
    {
      name: 'Projets',
      data: { step: 'projects', login: 'octocat', system: 'linux', command: null, shortId: null, failure: null, runner: RUNNER, busy: false },
    },
  ],
});
