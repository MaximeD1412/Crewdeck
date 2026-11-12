import { z } from 'zod';
import { zAiAccountModel } from '../api/ai-accounts.js';
import { ENGINE_ACCOUNT_KINDS, ENGINE_ACCOUNT_STATES, zEngineId } from '../runner/engines.js';

/**
 * A Moteur as « Premiers pas » and « Runner et Comptes IA » show it (US-38):
 * its Compte IA's kind and state, whether its version is one the adapter
 * knows, its models usable or why not, and the command that connects it on
 * the Runner (`crewdeck-runner login claude`). A Moteur the Runner never
 * reported shows as one not connected yet: `login-required`, without models.
 */
export const zEngineAccount = z.object({
  engine: zEngineId,
  installed: z.boolean(),
  knownVersion: z.boolean(),
  kind: z.enum(ENGINE_ACCOUNT_KINDS),
  state: z.enum(ENGINE_ACCOUNT_STATES),
  models: z.array(zAiAccountModel),
  command: z.string().min(1),
});
export type EngineAccount = z.infer<typeof zEngineAccount>;

/** The examples' Moteurs: Claude Code by subscription, one model outside the plan; Codex not connected. */
export const EXAMPLE_ENGINES: readonly EngineAccount[] = [
  {
    engine: 'claude-code',
    installed: true,
    knownVersion: true,
    kind: 'subscription',
    state: 'connected',
    models: [
      { id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', usable: true },
      { id: 'claude-fable-5-1', label: 'Fable 5.1', usable: false, reason: 'not-in-plan' },
    ],
    command: 'crewdeck-runner login claude',
  },
  { engine: 'codex', installed: true, knownVersion: true, kind: 'none', state: 'login-required', models: [], command: 'crewdeck-runner login codex' },
];

/** Neither Moteur connected. */
export const EXAMPLE_ENGINES_NONE: readonly EngineAccount[] = [
  { engine: 'claude-code', installed: true, knownVersion: true, kind: 'none', state: 'login-required', models: [], command: 'crewdeck-runner login claude' },
  { engine: 'codex', installed: true, knownVersion: true, kind: 'none', state: 'login-required', models: [], command: 'crewdeck-runner login codex' },
];
