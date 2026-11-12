import type { AiAccount, Runner } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import { runnerView } from './runner.js';

const RUNNER: Runner = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b',
  machine: 'atelier-pc',
  os: 'linux',
  arch: 'amd64',
  wsl: true,
  runnerVersion: '0.4.2',
  state: 'offline',
  lastSeenAt: '2026-11-11T14:12:00.000Z',
  linkedAt: '2026-11-11T14:11:00.000Z',
};
const account = (engine: AiAccount['engine'], connected: boolean): AiAccount => ({
  id: `018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a${engine === 'codex' ? '7d' : '7c'}`,
  engine,
  installed: true,
  version: '1.0.0',
  knownVersion: true,
  kind: connected ? 'api-key' : 'none',
  state: connected ? 'connected' : 'login-required',
  models: connected ? [{ id: `${engine}-model`, label: 'Modèle', usable: true }] : [],
  reportedAt: '2026-11-11T14:12:00.000Z',
});

const valid = (...args: Parameters<typeof runnerView>) => COMPOSANTS.PageRunner.data.parse(runnerView(...args));

describe('runnerView', () => {
  it('gives the Runner’s machine and state, and both Moteurs', () => {
    const view = valid({ runner: RUNNER, accounts: [account('claude-code', true)] });
    expect(view.runner).toEqual({
      machine: 'atelier-pc',
      os: 'linux',
      arch: 'amd64',
      wsl: true,
      runnerVersion: '0.4.2',
      state: 'offline',
      lastSeenAt: RUNNER.lastSeenAt,
    });
    expect(view.engines.map(({ engine, state }) => ({ engine, state }))).toEqual([
      { engine: 'claude-code', state: 'connected' },
      { engine: 'codex', state: 'login-required' },
    ]);
  });

  it('shows the command of the first Moteur not connected, Claude Code’s once all are', () => {
    expect(valid({ runner: RUNNER, accounts: [account('claude-code', true)] }).command).toBe('crewdeck-runner login codex');
    expect(valid({ runner: RUNNER, accounts: [] }).command).toBe('crewdeck-runner login claude');
    expect(valid({ runner: RUNNER, accounts: [account('claude-code', true), account('codex', true)] }).command).toBe('crewdeck-runner login claude');
  });

  it('has no Runner while none is linked', () => {
    expect(valid({ runner: null, accounts: [] }).runner).toBeNull();
  });
});
