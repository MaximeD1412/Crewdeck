import { DEFAULT_ACCOUNT_SETTINGS, folderCheckedAad, projectNameAad, type Me, type Project, type Repository, type Runner } from '@crewdeck/contracts';
import { emitAction, PageProjets } from '@crewdeck/sdk';
import type { z } from 'zod';
import { createDispatcher } from './actions/dispatcher.js';
import type { Client } from './api/client.js';
import { boot, type App } from './app.js';
import { fromBase64Url } from './keys/bytes.js';
import type { PageKeys } from './keys/index.js';
import { fakeFolderSocket, fakeSealed, fakeVault } from './projects/testing.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [] };
const AT = '2026-11-12T09:00:00.000Z';
const LOCAL_ID = '019a6f00-0000-7000-8000-000000000021';
const REPOSITORY: Repository = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a81',
  owner: 'octocat',
  name: 'site-mairie',
  fullName: 'octocat/site-mairie',
  private: true,
  defaultBranch: 'main',
  hasCode: true,
  followed: false,
};
const PROJECT: Project = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a80',
  repositoryId: REPOSITORY.id,
  owner: 'octocat',
  name: 'site-mairie',
  fullName: 'octocat/site-mairie',
  displayName: 'Site de la mairie',
  nameSealed: null,
  folder: null,
  releaseBranch: 'main',
  integrationBranch: 'develop',
  hasCode: true,
  inventoryState: 'pending',
  accessLost: false,
  followedAt: AT,
};
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
const TEMPLATES = { templates: [{ id: 'process-crewdeck', label: 'Process Crewdeck' }], templateId: 'process-crewdeck' };

/** A Local Projet as the server keeps it: its name sealed, its path nowhere. */
const localProject = async (id: string, name: string, folder: Project['folder'] = 'present'): Promise<Project> => ({
  ...PROJECT,
  id,
  repositoryId: null,
  owner: null,
  name: null,
  fullName: null,
  displayName: null,
  nameSealed: await fakeSealed(name, projectNameAad(id)),
  folder,
  hasCode: false,
  inventoryState: 'not-needed',
});

type WithData = HTMLElement & { data: Record<string, unknown> };

describe('« Projets » in the page', () => {
  let app: App;
  let root: HTMLElement;
  const commands: { path: string; body: Record<string, unknown> }[] = [];
  let answer: (path: string, body: Record<string, unknown>) => Promise<unknown> = async () => ({ items: [PROJECT] });
  const store = createStore();
  store.registerSlice('pilot', { shape: 'single' });
  store.registerSlice('runner', { shape: 'single' });
  store.registerSlice('project', { shape: 'collection', snapshotKey: 'projects' });
  store.registerSlice('repository', { shape: 'collection', snapshotKey: 'repositories' });
  const client: Pick<Client, 'command' | 'query'> = {
    query: (async () => ({ githubApiUrl: 'https://api.github.example', githubWebUrl: 'https://github.example', appSlug: 'crewdeck', runnerServer: null })) as Client['query'],
    command: (async (_method: string, path: string, body: Record<string, unknown>, schema?: z.ZodType) => {
      commands.push({ path, body });
      return schema?.parse(await answer(path, body));
    }) as Client['command'],
  };
  const socket = fakeFolderSocket();
  const keys = {
    linkKeys: {} as PageKeys['linkKeys'],
    vault: fakeVault() as unknown as PageKeys['vault'],
    nameDevice: async () => undefined,
    unlockVault: async () => {
      store.setVaultState('unlocked');
      return 'unlocked' as const;
    },
  };
  const page = (tag: string) => root.querySelector<WithData>(tag);
  const act = (composant: string, action: string, payload: unknown) => app.dispatcher.dispatch({ composant, action, payload });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const folder = () => page('cd-page-ajouter-projet')?.data['folder'] as Record<string, unknown>;

  /** Types `path` and answers the Runner's check of it with `result`. */
  const checked = async (path: string, result: Record<string, unknown>) => {
    const before = socket.sent.length;
    await act('FolderProjectForm', 'checkPath', { path });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(before + 1), { timeout: 2000 });
    const { requestId } = socket.sent[before] ?? { requestId: '' };
    socket.receive({ type: 'folder.checked', requestId, sealed: await fakeSealed(JSON.stringify(result), folderCheckedAad(requestId)) });
    await vi.waitFor(() => expect(folder()['check']).toMatchObject({ state: result['state'] }));
  };

  beforeAll(async () => {
    history.replaceState(null, '', '/projets');
    root = document.createElement('div');
    document.body.append(root);
    app = await boot({ root, dispatcher: createDispatcher(), me: async () => PILOT, store, client, keys, folders: socket, connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() } });
  });

  afterAll(() => app.stop());

  it('opens /projets on the list, empty before any Projet', () => {
    expect(location.pathname).toBe('/projets');
    expect(page('cd-page-projets')?.data).toEqual({ projects: [] });
  });

  it('follows the store: a Projet appears in real time, a Local one by its name opened, on the Runner’s machine', async () => {
    store.applySnapshot({ seq: 1, pilot: PILOT, runner: RUNNER, 'runner-link': null, 'ai-account': [], 'mcp-server': [], devices: [], projects: [], processes: [], phaseRuns: [], stepRuns: [], repositories: [REPOSITORY], decisions: [], ideas: [], tickets: [], milestones: [], codeChanges: [], sessions: [], settings: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' } });
    store.applyEvent({ seq: 2, type: 'project.upserted', payload: PROJECT, at: AT });
    store.applyEvent({ seq: 3, type: 'project.upserted', payload: await localProject(LOCAL_ID, 'Atelier'), at: AT });

    await vi.waitFor(() =>
      expect(page('cd-page-projets')?.data).toEqual({
        projects: [
          { id: LOCAL_ID, name: 'Atelier', meta: 'Local · sur atelier-pc' },
          { id: PROJECT.id, name: 'Site de la mairie', meta: 'octocat/site-mairie' },
        ],
      }),
    );
    store.applyEvent({ seq: 4, type: 'project.removed', payload: { id: PROJECT.id }, at: AT });
  });

  it('« Ajouter un Projet » opens on « Dépôt GitHub » when the Pilote has one: the repositories not followed, GitHub’s installation page, the Modèle', async () => {
    emitAction(page('cd-page-projets') as HTMLElement, PageProjets, 'add', {});
    await settle();

    expect(location.pathname).toBe('/projets/ajouter');
    expect(page('cd-page-ajouter-projet')?.data).toMatchObject({
      tab: 'github',
      repick: null,
      picker: {
        context: 'projets',
        repositories: [{ id: REPOSITORY.id, fullName: 'octocat/site-mairie', hasCode: true }],
        installUrl: 'https://github.example/apps/crewdeck/installations/new?state=projets',
        busy: false,
        ...TEMPLATES,
      },
    });
  });

  it('the folder’s tab checks the path typed with the Runner, sealed, and proposes the folder’s name', async () => {
    await act('PageAjouterProjet', 'selectTab', { id: 'dossier' });
    expect(page('cd-page-ajouter-projet')?.data).toMatchObject({ tab: 'dossier' });
    expect(folder()).toEqual({ context: 'projets', path: '', check: { state: 'idle', hasCode: false }, name: '', ...TEMPLATES, busy: false, vaultLocked: false, machine: 'atelier-pc' });

    await checked('~/projets/recettes', { state: 'ready', hasCode: true, branch: 'main', name: 'recettes' });

    expect(JSON.stringify(socket.sent)).not.toContain('recettes');
    expect(folder()).toMatchObject({ path: '~/projets/recettes', check: { state: 'ready', hasCode: true }, name: 'recettes' });
  });

  it('« Créer le Projet » posts its name and path sealed, then opens its page, its folder on the Runner’s machine', async () => {
    answer = async (_path, body) => ({ ...(await localProject(String(body['id']), 'Recettes', 'pending')), id: String(body['id']), nameSealed: body['nameSealed'] });

    await act('FolderProjectForm', 'create', { path: '~/projets/recettes', name: 'Recettes', templateId: 'process-crewdeck' });
    await vi.waitFor(() => expect(location.pathname).toMatch(/^\/projets\/[0-9a-f-]{36}$/));

    const sent = commands.at(-1);
    expect(sent).toMatchObject({ path: '/api/projects/local', body: { hasCode: true, releaseBranch: 'main', templateId: 'process-crewdeck' } });
    expect(JSON.stringify(sent?.body)).not.toMatch(/recettes|Recettes/);
    const id = String(sent?.body['id']);
    expect(new TextDecoder().decode(fromBase64Url((sent?.body['nameSealed'] as { ciphertext: string }).ciphertext))).toBe(`${projectNameAad(id)}Recettes`);
    expect(location.pathname).toBe(`/projets/${id}`);
    await vi.waitFor(() =>
      expect(page('cd-page-projet')?.data).toEqual({ id, name: 'Recettes', fullName: null, folder: { state: 'pending', machine: 'atelier-pc' }, connectors: [], followedAt: AT }),
    );

    await act('PageProjet', 'openProcess', {});
    expect(location.pathname).toBe(`/projets/${id}/process`);
  });

  it('a Projet the Pilote does not have leads back to the list', () => {
    app.router.navigate('/projets/019a6f00-0000-7000-8000-0000000000ff');
    expect(location.pathname).toBe('/projets');
  });

  it('?projet= chooses a Local Projet’s folder again: its name, the path only, then its page', async () => {
    store.applyEvent({ seq: 5, type: 'project.upserted', payload: await localProject(LOCAL_ID, 'Atelier', 'missing'), at: AT });
    app.router.navigate(`/projets/ajouter?projet=${LOCAL_ID}`);
    await settle();

    expect(page('cd-page-ajouter-projet')?.data).toMatchObject({ tab: 'dossier', repick: { projectId: LOCAL_ID, name: 'Atelier' } });
    expect(folder()).toMatchObject({ context: 'repick', path: '', name: 'Atelier' });

    await checked('/srv/atelier', { state: 'not-git', hasCode: true, branch: null, name: 'atelier' });
    // The check names the Projet, sealed: its own folder is not another Projet's.
    const sealed = socket.sent.at(-1)?.sealed.ciphertext ?? '';
    expect(new TextDecoder().decode(fromBase64Url(sealed))).toContain(`{"path":"/srv/atelier","projectId":"${LOCAL_ID}"}`);
    expect(folder()['name']).toBe('Atelier');
    answer = async () => localProject(LOCAL_ID, 'Atelier', 'pending');
    await act('FolderProjectForm', 'create', { path: '/srv/atelier', name: 'Atelier', templateId: 'process-crewdeck' });

    await vi.waitFor(() => expect(location.pathname).toBe(`/projets/${LOCAL_ID}`));
    expect(commands.at(-1)?.path).toBe(`/api/projects/${LOCAL_ID}/folder`);
    expect(JSON.stringify(commands.at(-1)?.body)).not.toContain('/srv/atelier');
  });

  it('the check follows the Runner: gone, « Créer le Projet » has nothing to create from; back, the path is checked again', async () => {
    app.router.navigate('/projets/ajouter');
    await act('PageAjouterProjet', 'selectTab', { id: 'dossier' });
    await checked('~/projets/recettes', { state: 'ready', hasCode: true, branch: 'main', name: 'recettes' });

    store.applyEvent({ seq: 6, type: 'runner.upserted', payload: { ...RUNNER, state: 'offline' }, at: AT });
    await vi.waitFor(() => expect(folder()['check']).toEqual({ state: 'runner-offline', hasCode: false }));
    const before = commands.length;
    await act('FolderProjectForm', 'create', { path: '~/projets/recettes', name: 'recettes', templateId: 'process-crewdeck' });
    expect(commands).toHaveLength(before);

    const sent = socket.sent.length;
    store.applyEvent({ seq: 7, type: 'runner.upserted', payload: RUNNER, at: AT });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(sent + 1));
    expect(folder()['check']).toEqual({ state: 'checking', hasCode: false });
    const { requestId } = socket.sent[sent] ?? { requestId: '' };
    const ready = { state: 'ready', hasCode: true, branch: 'main', name: 'recettes' };
    socket.receive({ type: 'folder.checked', requestId, sealed: await fakeSealed(JSON.stringify(ready), folderCheckedAad(requestId)) });
    await vi.waitFor(() => expect(folder()['check']).toEqual({ state: 'ready', hasCode: true }));
  });

  it('following posts the repositories with the Modèle, the picker busy meanwhile, then shows the list', async () => {
    app.router.navigate('/projets/ajouter');
    await act('PageAjouterProjet', 'selectTab', { id: 'github' });
    let release: () => void = () => undefined;
    answer = () =>
      new Promise((resolve) => {
        release = () => resolve({ items: [PROJECT] });
      });
    void act('RepositoryPicker', 'follow', { repositoryIds: [REPOSITORY.id], templateId: 'process-crewdeck' });
    await settle();

    expect(commands.at(-1)).toEqual({ path: '/api/projects', body: { repositoryIds: [REPOSITORY.id], templateId: 'process-crewdeck' } });
    expect(page('cd-page-ajouter-projet')?.data).toMatchObject({ picker: { busy: true } });

    release();
    await settle();

    expect(location.pathname).toBe('/projets');
  });
});
