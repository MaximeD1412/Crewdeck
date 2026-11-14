import type { AiAccount, Runner } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import { demarrageView, installCommand, systemOfBrowser, type DemarrageState } from './demarrage.js';

const CODE = { shortId: '7KQ4', secret: 'M2PXA7QK9VZ3T8W4R6N1B5C0DE' };
const RUNNER: Runner = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b',
  machine: 'atelier-pc',
  os: 'linux',
  arch: 'amd64',
  wsl: true,
  runnerVersion: '0.4.2',
  state: 'online',
  lastSeenAt: '2026-11-11T14:12:00.000Z',
  linkedAt: '2026-11-11T14:11:00.000Z',
};
const STATE: DemarrageState = {
  pilot: { displayName: 'octocat', gettingStartedStep: 'runner' },
  runner: null,
  system: 'linux',
  code: CODE,
  failure: null,
  busy: false,
  origin: 'https://crewdeck.example',
  server: null,
  accounts: [],
};
const CLAUDE: AiAccount = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7c',
  engine: 'claude-code',
  installed: true,
  version: '2.1.3',
  knownVersion: false,
  kind: 'subscription',
  state: 'connected',
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', usable: false, reason: 'not-in-plan' },
  ],
  reportedAt: '2026-11-11T14:12:00.000Z',
};
const NOT_CONNECTED = (engine: 'claude-code' | 'codex', command: string) => ({
  engine,
  installed: true,
  knownVersion: true,
  kind: 'none',
  state: 'login-required',
  models: [],
  command,
});

const valid = (state: DemarrageState) => COMPOSANTS.PageDemarrage.data.parse(demarrageView(state));

describe('installCommand', () => {
  it('names the full code, and the server only off production', () => {
    expect(installCommand('https://crewdeck.example', CODE, null)).toBe(
      'curl -fsSL https://crewdeck.example/runner/install.sh | sh -s -- --link 7KQ4-M2PXA7QK9VZ3T8W4R6N1B5C0DE',
    );
    expect(installCommand('http://localhost:4200', CODE, 'http://localhost:4200')).toBe(
      'curl -fsSL http://localhost:4200/runner/install.sh | sh -s -- --link 7KQ4-M2PXA7QK9VZ3T8W4R6N1B5C0DE --server http://localhost:4200',
    );
  });
});

describe('systemOfBrowser', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'macos'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'wsl'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'linux'],
    ['', 'linux'],
  ] as const)('opens the tab of %s', (userAgent, system) => {
    expect(systemOfBrowser(userAgent)).toBe(system);
  });
});

describe('demarrageView', () => {
  it('waits for the Runner with the command of the page’s code and its short id', () => {
    expect(valid(STATE)).toEqual({
      step: 'runner',
      displayName: 'octocat',
      system: 'linux',
      command: installCommand(STATE.origin, CODE, null),
      shortId: '7KQ4',
      failure: null,
      runner: null,
      busy: false,
      engines: [NOT_CONNECTED('claude-code', 'crewdeck-runner login claude'), NOT_CONNECTED('codex', 'crewdeck-runner login codex')],
      usable: false,
    });
  });

  it('gives both Moteurs, as their Runner reported them or not connected, and usable once a Rôle can run on one', () => {
    const view = valid({ ...STATE, pilot: { displayName: 'octocat', gettingStartedStep: 'ai-accounts' }, runner: RUNNER, accounts: [CLAUDE] });
    expect(view.engines).toEqual([
      {
        engine: 'claude-code',
        installed: true,
        knownVersion: false,
        kind: 'subscription',
        state: 'connected',
        models: CLAUDE.models,
        command: 'crewdeck-runner login claude',
      },
      NOT_CONNECTED('codex', 'crewdeck-runner login codex'),
    ]);
    expect(view.usable).toBe(true);
  });

  it('is not usable while no connected Moteur has a usable model', () => {
    const quota = { ...CLAUDE, models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', usable: false, reason: 'quota-reached' as const }] };
    expect(valid({ ...STATE, runner: RUNNER, accounts: [quota] }).usable).toBe(false);
    expect(valid({ ...STATE, runner: RUNNER, accounts: [{ ...CLAUDE, state: 'login-required', kind: 'none' }] }).usable).toBe(false);
  });

  it('has no command before the code is drawn, and keeps the failure for its Banner', () => {
    const failure = { reason: 'expired', shortId: '9RTB' } as const;
    expect(valid({ ...STATE, code: null, failure })).toMatchObject({ command: null, shortId: null, failure });
  });

  it('once linked, gives the Runner’s machine and no command nor failure', () => {
    expect(valid({ ...STATE, runner: RUNNER, failure: { reason: 'expired', shortId: '9RTB' } })).toMatchObject({
      command: null,
      shortId: null,
      failure: null,
      runner: { machine: 'atelier-pc', os: 'linux', arch: 'amd64', wsl: true, runnerVersion: '0.4.2', state: 'online', lastSeenAt: RUNNER.lastSeenAt },
    });
  });

  it('reads `done`, the instant before the router leaves, as the last step', () => {
    expect(valid({ ...STATE, pilot: { displayName: 'octocat', gettingStartedStep: 'done' }, runner: RUNNER, busy: true })).toMatchObject({
      step: 'projects',
      busy: true,
    });
  });
});
