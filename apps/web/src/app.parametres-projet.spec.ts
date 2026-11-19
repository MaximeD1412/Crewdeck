import { DEFAULT_ACCOUNT_SETTINGS, type AiAccount, type Me, type Project, type ProjectSettings } from '@crewdeck/contracts';
import { emitAction, PageParametresProjet, SettingRow, t } from '@crewdeck/sdk';
import type { z } from 'zod';
import { createDispatcher } from './actions/dispatcher.js';
import type { Client } from './api/client.js';
import { boot, type App } from './app.js';
import { applySettingsEvent } from './store/settings.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [], githubLinked: false };
const AT = '2026-11-12T09:00:00.000Z';
const PROJECT: Project = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a80',
  repositoryId: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a81',
  owner: 'octocat',
  name: 'site-mairie',
  fullName: 'octocat/site-mairie',
  displayName: 'Site mairie',
  nameSealed: null,
  folder: null,
  releaseBranch: 'main',
  integrationBranch: 'develop',
  hasCode: true,
  inventoryState: 'approved',
  accessLost: false,
  followedAt: AT,
};
const CODEX: AiAccount = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b02',
  engine: 'codex',
  installed: true,
  version: '1.0.0',
  knownVersion: true,
  kind: 'api-key',
  state: 'connected',
  models: [{ id: 'gpt-5.5', label: 'GPT-5.5', usable: true }],
  reportedAt: AT,
};
const ACCOUNT = { ...DEFAULT_ACCOUNT_SETTINGS, notifications: { push: true }, timeZone: 'Europe/Paris' };
const OWN: ProjectSettings = {
  projectId: PROJECT.id,
  effective: ACCOUNT,
  origins: { roles: { idea: 'compte', design: 'compte', code: 'compte', review: 'compte' }, notifications: { push: 'compte' } },
  changedCount: 0,
  branches: { integration: 'develop', release: 'main' },
  worktreeCommands: null,
};

type WithData = HTMLElement & { data: Record<string, unknown> };

// Its own file: a page has one Skin, booted once.
describe('a Projet’s Paramètres in the page', () => {
  let app: App;
  let root: HTMLElement;
  const commands: { method: string; path: string; body: object }[] = [];
  const store = createStore();
  store.registerSlice('pilot', { shape: 'single' });
  store.registerSlice('project', { shape: 'collection', snapshotKey: 'projects' });
  store.registerSlice('ai-account', { shape: 'collection' });
  store.registerSlice('settings', { shape: 'single', apply: applySettingsEvent });
  const client: Pick<Client, 'command' | 'query'> = {
    query: vi.fn() as Client['query'],
    command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
      commands.push({ method, path, body });
      return schema?.parse(OWN);
    }) as Client['command'],
  };
  const page = () => root.querySelector<WithData>('cd-page-parametres-projet');
  const slotsOf = () => [...(page()?.children ?? [])].map((child) => child.getAttribute('slot'));
  const row = (name: string) => [...(page()?.querySelectorAll<WithData>('cd-setting-row') ?? [])].find((one) => one.data['name'] === name);

  beforeAll(async () => {
    history.replaceState(null, '', `/projets/${PROJECT.id}/parametres`);
    root = document.createElement('div');
    document.body.append(root);
    app = await boot({ root, dispatcher: createDispatcher(), me: async () => PILOT, store, client, connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() } });
  });

  afterAll(() => app.stop());

  it('opens /projets/:id/parametres, empty until the store has the Projet and the settings', () => {
    expect(location.pathname).toBe(`/projets/${PROJECT.id}/parametres`);
    expect(page()?.data).toEqual({ project: '', changedCount: 0, counts: {} });
    expect(slotsOf()).toEqual([]);
  });

  it('then shows the Projet’s sections, its Rôles inherited from the account, following the events of its Paramètres', () => {
    store.applySnapshot({
      seq: 1, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [CODEX], 'mcp-server': [], devices: [], 'push-subscriptions': [], vault: { version: 1, rotationPending: false }, projects: [PROJECT], processes: [], phaseRuns: [], stepRuns: [],
      repositories: [], decisions: [], ideas: [], tickets: [], milestones: [], codeChanges: [], sessions: [], settings: { ...ACCOUNT, projects: [OWN] }, usage: [],
    });
    expect(page()?.data).toEqual({ project: 'Site mairie', changedCount: 0, counts: {} });
    expect(slotsOf()).toEqual(['roles', 'steps', 'branches', 'worktree', 'notifications']);
    expect(row('role:code')?.data['origin']).toBe('compte');
    // Its Étapes link to the Gestion du process (PROCESS-7).
    expect(page()?.querySelector<WithData>('cd-card[slot=steps] cd-list-row')?.data['href']).toBe(`/projets/${PROJECT.id}/process`);
    // A browser that is no trusted Appareil: the worktree Commandes stay closed.
    expect(page()?.querySelector<WithData>('cd-card[slot=worktree] cd-text-field')?.data).toMatchObject({ state: 'disabled', help: t('settings.project.worktree.locked') });

    const changed: ProjectSettings = { ...OWN, origins: { ...OWN.origins, notifications: { push: 'projet' } }, effective: { ...ACCOUNT, notifications: { push: false } }, changedCount: 1 };
    store.applyEvent({ seq: 2, type: 'settings.upserted', payload: { projectSettings: changed }, at: AT });
    expect(page()?.data).toEqual({ project: 'Site mairie', changedCount: 1, counts: { notifications: 1 } });
    expect(row('push')?.data['origin']).toBe('projet');

    // The account changed: the Projet still holds its own.
    store.applyEvent({ seq: 3, type: 'settings.upserted', payload: { ...ACCOUNT, timeZone: 'Asia/Tokyo' }, at: AT });
    expect(page()?.data['changedCount']).toBe(1);
  });

  it('sends a control’s change and a « Revenir au compte » to the Projet’s settings', async () => {
    emitAction(page() as HTMLElement, PageParametresProjet, 'change', { name: 'role:code', value: 'codex:gpt-5.5' });
    await vi.waitFor(() =>
      expect(commands.at(-1)).toEqual({ method: 'PATCH', path: `/api/projects/${PROJECT.id}/settings`, body: { roles: { code: { engine: 'codex', model: 'gpt-5.5' } } } }),
    );

    emitAction(row('push') as HTMLElement, SettingRow, 'revert', { name: 'push' });
    await vi.waitFor(() => expect(commands.at(-1)).toEqual({ method: 'PATCH', path: `/api/projects/${PROJECT.id}/settings`, body: { notifications: { push: null } } }));
  });

  it('lists the Projet under « Par Projet » on the account’s Paramètres, with what it changed', () => {
    app.router.navigate('/parametres');
    const card = root.querySelector('cd-page-parametres cd-card[slot=projects]');
    expect((card?.querySelector('cd-list-row') as WithData | null)?.data).toEqual({
      title: 'Site mairie',
      meta: t('settings.projects.changed.one'),
      href: `/projets/${PROJECT.id}/parametres`,
    });
  });

  it('sends a Projet the store does not have back to the Projets', () => {
    app.router.navigate('/projets/018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a99/parametres');
    expect(location.pathname).toBe('/projets');
  });
});
