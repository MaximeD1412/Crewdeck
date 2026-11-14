import { DEFAULT_ACCOUNT_SETTINGS, type Me, type Runner } from '@crewdeck/contracts';
import { emitAction, PageDemarrage } from '@crewdeck/sdk';
import type { z } from 'zod';
import { createDispatcher } from './actions/dispatcher.js';
import type { Client } from './api/client.js';
import { boot, type App } from './app.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'runner' };
const LINK_ID = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a70';
const AT = '2026-11-11T14:12:00.000Z';
const DEVICE_ID = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a74';
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

type WithData<T = Record<string, unknown>> = HTMLElement & { data: T };

describe('« Premiers pas » in the page', () => {
  let app: App;
  let root: HTMLElement;
  const paths: string[] = [];
  const store = createStore();
  for (const slice of ['pilot', 'runner', 'runner-link'] as const) store.registerSlice(slice, { shape: 'single' });
  const client: Pick<Client, 'command' | 'query'> = {
    query: (async () => ({ githubApiUrl: 'https://x.invalid', githubWebUrl: 'https://x.invalid', appSlug: 'crewdeck', runnerServer: null })) as Client['query'],
    command: (async (_method: string, path: string, _body: object, schema?: z.ZodType) => {
      paths.push(path);
      const answer =
        path === '/api/runner/link-codes'
          ? { id: LINK_ID, shortId: '7KQ4', expiresAt: AT, deviceId: DEVICE_ID }
          : { ...PILOT, gettingStartedStep: path.endsWith('advance') ? 'ai-accounts' : 'runner' };
      return schema?.parse(answer);
    }) as Client['command'],
  };
  const named: string[] = [];
  const boots: string[] = [];
  const keys = {
    linkKeys: {
      browserPairing: async () => ({ devicePublicKey: 'D'.repeat(43), deviceName: 'Chrome sur Linux' }),
      adoptDevice: async (id: string) => {
        named.push(id);
      },
      confirmPairing: async () => null,
    },
    nameDevice: async () => {
      boots.push('nameDevice');
    },
    unlockVault: async () => {
      boots.push('unlockVault');
      return 'no-device' as const;
    },
    approval: { register: vi.fn(), adopt: vi.fn(), check: vi.fn(), approve: vi.fn() },
  };
  const page = () => root.querySelector<WithData>('cd-page-demarrage');

  beforeAll(async () => {
    history.replaceState(null, '', '/a-toi');
    root = document.createElement('div');
    document.body.append(root);
    app = await boot({ root, dispatcher: createDispatcher(), me: async () => PILOT, store, client, keys, connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() } });
  });

  afterAll(() => app.stop());

  it('names this browser’s Appareil and opens the vault at boot', () => {
    expect(boots).toEqual(['nameDevice', 'unlockVault']);
  });

  it('a Pilote at the Runner’s step opening /a-toi lands on /demarrage, in the bare Cadre', () => {
    expect(location.pathname).toBe('/demarrage');
    expect((root.firstElementChild as WithData).data).toMatchObject({ variant: 'bare' });
    expect(page()?.data).toMatchObject({ step: 'runner', login: 'octocat', command: null });
  });

  it('draws its code once the snapshot is there and shows its command', async () => {
    store.applySnapshot({ seq: 1, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [], devices: [], settings: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' }, decisions: [] });
    await vi.waitFor(() => expect(page()?.data).toMatchObject({ shortId: '7KQ4' }));
    expect(page()?.data['command']).toMatch(/--link 7KQ4-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(paths).toEqual(['/api/runner/link-codes']);
    expect(named).toEqual([DEVICE_ID]);
  });

  it('switches the system tab through the page’s action', () => {
    emitAction(page() as HTMLElement, PageDemarrage, 'selectSystem', { system: 'wsl' });
    expect(page()?.data).toMatchObject({ system: 'wsl', shortId: '7KQ4' });
  });

  it('once linked, « Continuer » moves the Pilote on; a step `done` leads to « À toi »', async () => {
    store.applyEvent({ seq: 2, type: 'runner.upserted', payload: RUNNER, at: AT });
    expect(page()?.data).toMatchObject({ runner: { machine: 'atelier-pc' } });
    emitAction(page() as HTMLElement, PageDemarrage, 'continue', {});
    await vi.waitFor(() => expect(page()?.data).toMatchObject({ step: 'ai-accounts' }));
    expect(paths.at(-1)).toBe('/api/me/getting-started/advance');

    app.router.navigate('/idees');
    expect(location.pathname).toBe('/demarrage');

    store.applyEvent({ seq: 3, type: 'pilot.upserted', payload: { ...PILOT, gettingStartedStep: 'done' }, at: AT });
    expect(location.pathname).toBe('/a-toi');
    expect((root.firstElementChild as WithData).data).toMatchObject({ variant: 'default' });
  });
});
