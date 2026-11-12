import type { EngineCapabilities } from '@crewdeck/contracts';

/** The Moteurs the scenarios' Runner reports, as the mockups show them (`design/screens/crewdeck/runner.html`). */
const FEATURES = { interrupt: true, resume: true, questions: true, permissions: true };

/** Claude Code by subscription: Opus and Sonnet usable, Fable outside the plan. */
export const CLAUDE_SUBSCRIPTION: EngineCapabilities = {
  engine: 'claude-code',
  installed: true,
  version: '2.1.3',
  knownVersion: true,
  account: { kind: 'subscription', state: 'connected' },
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', usable: true },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', usable: false, reason: 'not-in-plan' },
  ],
  features: FEATURES,
};

/** Claude Code installed, signed out: no model listed yet. */
export const CLAUDE_SIGNED_OUT: EngineCapabilities = {
  engine: 'claude-code',
  installed: true,
  version: '2.1.3',
  knownVersion: true,
  account: { kind: 'none', state: 'login-required' },
  models: [],
  features: FEATURES,
};

/** Codex by API key: GPT-5.5 usable, GPT-5.5 Pro at its quota. */
export const CODEX_API_KEY: EngineCapabilities = {
  engine: 'codex',
  installed: true,
  version: '0.9.0',
  knownVersion: true,
  account: { kind: 'api-key', state: 'connected' },
  models: [
    { id: 'gpt-5.5', label: 'GPT-5.5', usable: true },
    { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', usable: false, reason: 'quota-reached' },
  ],
  features: FEATURES,
};

/** Codex installed, without its key. */
export const CODEX_SIGNED_OUT: EngineCapabilities = {
  engine: 'codex',
  installed: true,
  version: '0.9.0',
  knownVersion: true,
  account: { kind: 'none', state: 'login-required' },
  models: [],
  features: FEATURES,
};
