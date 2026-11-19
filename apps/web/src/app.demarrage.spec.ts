import { DEFAULT_ACCOUNT_SETTINGS, folderCheckedAad, type Me, type Runner } from '@crewdeck/contracts';
import { emitAction, PageDemarrage } from '@crewdeck/sdk';
import type { z } from 'zod';
import { createDispatcher } from './actions/dispatcher.js';
import type { Client } from './api/client.js';
import { boot, type App } from './app.js';
import type { PageKeys } from './keys/index.js';
import { fakeFolderSocket, fakeSealed, fakeVault } from './projects/testing.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'runner', identities: [{ provider: 'github', label: 'octocat', reconnect: false }], githubLinked: true };
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
  const bodies: Record<string, unknown>[] = [];
  const NEXT: Record<string, string> = { runner: 'ai-accounts', 'ai-accounts': 'projects', projects: 'done' };
  const store = createStore();
  for (const slice of ['pilot', 'runner', 'runner-link'] as const) store.registerSlice(slice, { shape: 'single' });
  const client: Pick<Client, 'command' | 'query'> = {
    query: (async () => ({ githubApiUrl: 'https://x.invalid', githubWebUrl: 'https://x.invalid', appSlug: 'crewdeck', runnerServer: null })) as Client['query'],
    command: (async (_method: string, path: string, body: Record<string, unknown>, schema?: z.ZodType) => {
      paths.push(path);
      bodies.push(body);
      const answer =
        path === '/api/runner/link-codes'
          ? { id: LINK_ID, shortId: '7KQ4', expiresAt: AT, deviceId: DEVICE_ID }
          : path === '/api/projects/local'
            ? {
                id: body['id'],
                repositoryId: null,
                owner: null,
                name: null,
                fullName: null,
                displayName: null,
                nameSealed: body['nameSealed'],
                folder: 'pending',
                releaseBranch: 'main',
                integrationBranch: 'develop',
                hasCode: false,
                inventoryState: 'not-needed',
                accessLost: false,
                readiness: null,
                followedAt: AT,
              }
            : { ...PILOT, gettingStartedStep: path.endsWith('advance') ? NEXT[String(body['from'])] : 'runner' };
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
    vault: fakeVault() as unknown as PageKeys['vault'],
    nameDevice: async () => {
      boots.push('nameDevice');
    },
    unlockVault: async () => {
      boots.push('unlockVault');
      return 'no-device' as const;
    },
    approval: { register: vi.fn(), adopt: vi.fn(), check: vi.fn(), approve: vi.fn() },
    rotateVault: async () => 'not-pending' as const,
    forgetDevice: async () => undefined,
  };
  const page = () => root.querySelector<WithData>('cd-page-demarrage');
  const socket = fakeFolderSocket();
  const act = (composant: string, action: string, payload: unknown) => app.dispatcher.dispatch({ composant, action, payload });
  const leave = vi.fn<(url: string) => void>();

  beforeAll(async () => {
    history.replaceState(null, '', '/a-toi');
    root = document.createElement('div');
    document.body.append(root);
    app = await boot({ root, dispatcher: createDispatcher(), me: async () => PILOT, store, client, keys, leave, folders: socket, connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() } });
  });

  afterAll(() => app.stop());

  it('names this browser’s Appareil and opens the vault at boot', () => {
    expect(boots).toEqual(['nameDevice', 'unlockVault']);
  });

  it('a Pilote at the Runner’s step opening /a-toi lands on /demarrage, in the bare Cadre', () => {
    expect(location.pathname).toBe('/demarrage');
    expect((root.firstElementChild as WithData).data).toMatchObject({ variant: 'bare' });
    expect(page()?.data).toMatchObject({ step: 'runner', displayName: 'octocat', command: null });
  });

  it('draws its code once the snapshot is there and shows its command', async () => {
    store.applySnapshot({ seq: 1, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [], 'mcp-server': [], devices: [], 'push-subscriptions': [], vault: { version: 1, rotationPending: false }, sourceMigrations: [], projects: [], processes: [], phaseRuns: [], stepRuns: [], repositories: [], decisions: [], ideas: [], tickets: [], milestones: [], codeChanges: [], sessions: [], settings: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris', projects: [] }, usage: [] });
    await vi.waitFor(() => expect(page()?.data).toMatchObject({ shortId: '7KQ4' }));
    expect(page()?.data['command']).toMatch(/--link 7KQ4-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(paths).toEqual(['/api/runner/link-codes']);
    expect(named).toEqual([DEVICE_ID]);
  });

  it('switches the system tab through the page’s action', () => {
    emitAction(page() as HTMLElement, PageDemarrage, 'selectSystem', { system: 'wsl' });
    expect(page()?.data).toMatchObject({ system: 'wsl', shortId: '7KQ4' });
  });

  it('gives the page whether GitHub is linked; « Relier GitHub » leaves for the link, back to /demarrage', () => {
    expect(page()?.data).toMatchObject({ githubLinked: true });
    emitAction(page() as HTMLElement, PageDemarrage, 'linkGitHub', {});
    expect(leave).toHaveBeenCalledWith('/api/auth/github/link?next=%2Fdemarrage');
  });

  it('once linked, « Continuer » moves the Pilote on', async () => {
    store.applyEvent({ seq: 2, type: 'runner.upserted', payload: RUNNER, at: AT });
    expect(page()?.data).toMatchObject({ runner: { machine: 'atelier-pc' } });
    emitAction(page() as HTMLElement, PageDemarrage, 'continue', {});
    await vi.waitFor(() => expect(page()?.data).toMatchObject({ step: 'ai-accounts' }));
    expect(paths.at(-1)).toBe('/api/me/getting-started/advance');

    app.router.navigate('/idees');
    expect(location.pathname).toBe('/demarrage');
  });

  it('the Projets’ step opens on the folder without a Dépôt GitHub; « Dépôt GitHub » through its tab', async () => {
    emitAction(page() as HTMLElement, PageDemarrage, 'continue', {});
    await vi.waitFor(() => expect(page()?.data).toMatchObject({ step: 'projects' }));

    expect(page()?.data).toMatchObject({
      projectsTab: 'dossier',
      folder: { context: 'demarrage', path: '', check: { state: 'idle', hasCode: false }, vaultLocked: true, machine: 'atelier-pc', templateId: 'process-crewdeck' },
      picker: { context: 'demarrage', templateId: 'process-crewdeck' },
    });
    act('PageDemarrage', 'selectProjectsTab', { id: 'github' });
    expect(page()?.data).toMatchObject({ projectsTab: 'github' });
    act('PageDemarrage', 'selectProjectsTab', { id: 'dossier' });
  });

  it('a Local Projet created ends « Premiers pas » as a Dépôt GitHub followed does', async () => {
    store.setVaultState('unlocked');
    act('FolderProjectForm', 'checkPath', { path: '~/projets/recettes' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1), { timeout: 2000 });
    const requestId = socket.sent[0]?.requestId ?? '';
    socket.receive({ type: 'folder.checked', requestId, sealed: await fakeSealed(JSON.stringify({ state: 'not-git', hasCode: false, branch: null, name: 'recettes' }), folderCheckedAad(requestId)) });
    await vi.waitFor(() => expect(page()?.data).toMatchObject({ folder: { check: { state: 'not-git' }, name: 'recettes', vaultLocked: false } }));

    act('FolderProjectForm', 'create', { path: '~/projets/recettes', name: 'recettes', templateId: 'process-crewdeck' });

    await vi.waitFor(() => expect(paths.slice(-2)).toEqual(['/api/projects/local', '/api/me/getting-started/advance']));
    expect(bodies.at(-2)).toMatchObject({ hasCode: false, releaseBranch: null, templateId: 'process-crewdeck' });
    expect(bodies.at(-1)).toMatchObject({ from: 'projects' });
  });

  it('a step `done` leads to « À toi »', () => {
    store.applyEvent({ seq: 3, type: 'pilot.upserted', payload: { ...PILOT, gettingStartedStep: 'done' }, at: AT });
    expect(location.pathname).toBe('/a-toi');
    expect((root.firstElementChild as WithData).data).toMatchObject({ variant: 'default' });
  });
});
