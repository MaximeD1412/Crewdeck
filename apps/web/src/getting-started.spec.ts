import type { Me, Runner, RunnerLink, State } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Client } from './api/client.js';
import { createGettingStarted, drawSecret, gettingStartedGuard, type GettingStarted } from './getting-started.js';
import { matchRoute } from './router.js';
import { ROUTES } from './routes.js';
import { createStore, type Store } from './store/store.js';

const ME: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'runner' };
const LINK_ID = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a70';
const AT = '2026-11-11T14:12:00.000Z';
const SECRET = 'M2PXA7QK9VZ3T8W4R6N1B5C0DE';
const RUNNER: Runner = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a71',
  machine: 'atelier-pc',
  os: 'linux',
  arch: 'amd64',
  wsl: false,
  runnerVersion: '0.4.2',
  state: 'online',
  lastSeenAt: AT,
  linkedAt: AT,
};
const CONFIG = { githubApiUrl: 'https://api.github.com', githubWebUrl: 'https://github.com', appSlug: 'crewdeck', runnerServer: null };

const link = (overrides: Partial<RunnerLink> = {}): RunnerLink => ({
  id: LINK_ID,
  shortId: '7KQ4',
  state: 'waiting',
  failureReason: null,
  expiresAt: AT,
  runnerPairing: null,
  ...overrides,
});

describe('gettingStartedGuard', () => {
  const guarded = (step: Me['gettingStartedStep'] | null, url: string) =>
    gettingStartedGuard(() => (step ? { gettingStartedStep: step } : null))(matchRoute(ROUTES, url));

  it.each(['/a-toi', '/idees/x', '/parametres/composants', '/connexion', '/nope'])('sends %s to /demarrage until the Premiers pas are done', (url) => {
    expect(guarded('runner', url)).toBe('/demarrage');
    expect(guarded('projects', url)).toBe('/demarrage');
  });

  it('lets /demarrage be until done, then sends it to « À toi »', () => {
    expect(guarded('ai-accounts', '/demarrage')).toBeNull();
    expect(guarded('done', '/demarrage')).toBe('/a-toi');
    expect(guarded('done', '/a-toi')).toBeNull();
  });

  it('lets the sign-in’s guard decide signed out', () => {
    expect(guarded(null, '/demarrage')).toBeNull();
  });
});

describe('drawSecret', () => {
  it('draws 26 Crockford characters, a new one each time', () => {
    const secret = drawSecret();
    expect(secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(drawSecret()).not.toBe(secret);
  });
});

describe('createGettingStarted', () => {
  let store: Store;
  let seq: number;
  let commands: { method: string; path: string; body: object }[];
  let answers: Record<string, () => unknown>;
  let controller: GettingStarted;

  const client: Pick<Client, 'command' | 'query'> = {
    query: (async () => CONFIG) as Client['query'],
    command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
      commands.push({ method, path, body });
      const answer = answers[path]?.();
      return schema ? schema.parse(answer) : undefined;
    }) as Client['command'],
  };

  const snapshot = (overrides: Partial<State> = {}) =>
    store.applySnapshot({ seq: seq++, pilot: ME, runner: null, 'runner-link': null, ...overrides });
  const event = (type: 'runner-link.upserted' | 'runner.upserted' | 'pilot.upserted', payload: unknown) =>
    store.applyEvent({ seq: seq++, type, payload, at: AT } as Parameters<Store['applyEvent']>[0]);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    store = createStore();
    for (const slice of ['pilot', 'runner', 'runner-link'] as const) store.registerSlice(slice, { shape: 'single' });
    seq = 1;
    commands = [];
    answers = {
      '/api/runner/link-codes': () => ({ id: LINK_ID, shortId: '7KQ4', expiresAt: AT }),
      [`/api/runner/link-codes/${LINK_ID}/confirm`]: () => ({ runner: RUNNER }),
      '/api/me/getting-started/advance': () => ({ ...ME, gettingStartedStep: 'ai-accounts' }),
    };
    controller = createGettingStarted({ store, client, bootPilot: ME, origin: 'https://crewdeck.example', system: 'linux', secret: () => SECRET });
    store.subscribe(() => controller.sync());
  });

  it('waits for the snapshot, then draws one code whose secret stays in the page', async () => {
    controller.sync();
    expect(commands).toEqual([]);
    snapshot();
    await flush();
    expect(commands).toEqual([{ method: 'POST', path: '/api/runner/link-codes', body: { pairing: {} } }]);
    expect(JSON.stringify(commands)).not.toContain(SECRET);
    expect(controller.view()).toMatchObject({
      step: 'runner',
      shortId: '7KQ4',
      command: `curl -fsSL https://crewdeck.example/runner/install.sh | sh -s -- --link 7KQ4-${SECRET}`,
      failure: null,
    });
    event('runner-link.upserted', link());
    await flush();
    expect(commands).toHaveLength(1);
  });

  it('confirms its pending code once, when the Runner’s pairing is there', async () => {
    snapshot();
    await flush();
    event('runner-link.upserted', link({ state: 'pending' }));
    expect(commands).toHaveLength(1);
    event('runner-link.upserted', link({ state: 'pending', runnerPairing: {} }));
    event('runner-link.upserted', link({ state: 'pending', runnerPairing: {} }));
    await flush();
    expect(commands.slice(1)).toEqual([{ method: 'POST', path: `/api/runner/link-codes/${LINK_ID}/confirm`, body: { pairing: {} } }]);
    event('runner.upserted', RUNNER);
    expect(controller.view()).toMatchObject({ command: null, runner: { machine: 'atelier-pc' } });
  });

  it('handles the failure of a code once, even when it comes again', async () => {
    snapshot();
    await flush();
    event('runner-link.upserted', link({ state: 'failed', failureReason: 'no-engine' }));
    await flush();
    event('runner-link.upserted', link({ state: 'failed', failureReason: 'no-engine' }));
    await flush();
    expect(commands).toHaveLength(2);
  });

  it('ignores a code that is not its own', async () => {
    snapshot();
    await flush();
    event('runner-link.upserted', link({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7f', state: 'pending', runnerPairing: {} }));
    event('runner-link.upserted', link({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7f', state: 'failed', failureReason: 'no-engine' }));
    await flush();
    expect(commands).toHaveLength(1);
  });

  it.each(['no-engine', 'unsupported-system', 'already-used'] as const)('after its code failed (%s), keeps the reason and draws a new code', async (reason) => {
    snapshot();
    await flush();
    answers['/api/runner/link-codes'] = () => ({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a72', shortId: '9RTB', expiresAt: AT });
    event('runner-link.upserted', link({ state: 'failed', failureReason: reason }));
    await flush();
    expect(commands.map((c) => c.path)).toEqual(['/api/runner/link-codes', '/api/runner/link-codes']);
    expect(controller.view()).toMatchObject({ failure: { reason, shortId: '7KQ4' }, shortId: '9RTB' });
  });

  it('an expired code too', async () => {
    snapshot();
    await flush();
    answers['/api/runner/link-codes'] = () => ({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a72', shortId: '9RTB', expiresAt: AT });
    event('runner-link.upserted', link({ state: 'expired', failureReason: 'expired' }));
    await flush();
    expect(commands).toHaveLength(2);
    expect(controller.view().failure).toEqual({ reason: 'expired', shortId: '7KQ4' });
  });

  it('shows at load the reason of the Pilote’s last failed code, then « Réessayer » clears it with a new code', async () => {
    snapshot({ 'runner-link': link({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a73', shortId: '9RTB', state: 'expired', failureReason: 'expired' }) });
    await flush();
    expect(controller.view()).toMatchObject({ failure: { reason: 'expired', shortId: '9RTB' }, shortId: '7KQ4' });
    await controller.retry();
    expect(commands).toHaveLength(2);
    expect(controller.view()).toMatchObject({ failure: null, shortId: '7KQ4' });
  });

  it('draws nothing once a Runner is linked, nor off the Runner’s step', async () => {
    snapshot({ runner: RUNNER });
    snapshot({ pilot: { ...ME, gettingStartedStep: 'ai-accounts' } });
    await flush();
    expect(commands).toEqual([]);
  });

  it('adds --server from /api/config off production', async () => {
    client.query = (async () => ({ ...CONFIG, runnerServer: 'http://localhost:4200' })) as Client['query'];
    snapshot();
    await flush();
    expect(controller.view().command).toMatch(/ --server http:\/\/localhost:4200$/);
    client.query = (async () => CONFIG) as Client['query'];
  });

  it('switches the tab without a new code', async () => {
    snapshot();
    await flush();
    const listener = vi.fn<() => void>();
    controller.subscribe(listener);
    controller.selectSystem('macos');
    expect(listener).toHaveBeenCalledOnce();
    expect(controller.view()).toMatchObject({ system: 'macos', shortId: '7KQ4' });
    expect(commands).toHaveLength(1);
  });

  it('« Continuer » is busy on its way, then shows the next step before the event and the store’s pilot after it', async () => {
    snapshot({ runner: RUNNER });
    const advancing = controller.advance();
    expect(controller.view().busy).toBe(true);
    await advancing;
    expect(commands).toEqual([{ method: 'POST', path: '/api/me/getting-started/advance', body: { from: 'runner' } }]);
    expect(controller.view()).toMatchObject({ busy: false, step: 'ai-accounts' });
    expect(controller.pilot()?.gettingStartedStep).toBe('ai-accounts');
    event('pilot.upserted', { ...ME, login: 'renamed', gettingStartedStep: 'ai-accounts' });
    expect(controller.pilot()?.login).toBe('renamed');
  });

  it('« Continuer » refused: not busy any more, the step unchanged, the error to the page', async () => {
    snapshot({ runner: RUNNER });
    answers['/api/me/getting-started/advance'] = () => {
      throw new Error('refused');
    };
    await expect(controller.advance()).rejects.toThrow('refused');
    expect(controller.view()).toMatchObject({ busy: false, step: 'runner' });
  });
});
