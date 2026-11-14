import type { AiAccount, McpServer, Runner } from '@crewdeck/contracts';
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

const server = (name: string, transport: McpServer['transport'], state: McpServer['state'], toolCount: number | null): McpServer => ({
  id: `018f6b2a-7c3d-7e4f-9a1b-${name.padEnd(12, '0').slice(0, 12).replace(/[^0-9a-f]/g, '0')}`,
  name,
  transport,
  state,
  toolCount,
  reportedAt: '2026-11-11T14:12:00.000Z',
});

const valid = (...args: Parameters<typeof runnerView>) => COMPOSANTS.PageRunner.data.parse(runnerView(...args));

describe('runnerView', () => {
  it('gives the Runner’s machine and state, and both Moteurs', () => {
    const view = valid({ runner: RUNNER, accounts: [account('claude-code', true)], mcpServers: [] });
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
    expect(valid({ runner: RUNNER, accounts: [account('claude-code', true)], mcpServers: [] }).command).toBe('crewdeck-runner login codex');
    expect(valid({ runner: RUNNER, accounts: [], mcpServers: [] }).command).toBe('crewdeck-runner login claude');
    expect(valid({ runner: RUNNER, accounts: [account('claude-code', true), account('codex', true)], mcpServers: [] }).command).toBe('crewdeck-runner login claude');
  });

  it('gives the Serveurs MCP by name, their transport, state and tool count only', () => {
    const view = valid({
      runner: RUNNER,
      accounts: [],
      mcpServers: [server('stitch', 'stdio', 'ready', 12), server('figma', 'http', 'failed', null)],
    });
    expect(view.mcpServers).toEqual([
      { name: 'figma', transport: 'http', state: 'failed', toolCount: null },
      { name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 12 },
    ]);
  });

  it('keeps the Serveurs MCP while the Runner is offline, and has none before any is reported', () => {
    expect(valid({ runner: RUNNER, accounts: [], mcpServers: [server('stitch', 'stdio', 'ready', 12)] }).mcpServers).toHaveLength(1);
    expect(valid({ runner: null, accounts: [], mcpServers: [] }).mcpServers).toEqual([]);
  });

  it('has no Runner while none is linked', () => {
    expect(valid({ runner: null, accounts: [], mcpServers: [] }).runner).toBeNull();
  });
});
