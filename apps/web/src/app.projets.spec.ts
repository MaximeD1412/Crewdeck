import type { Me, Project, Repository } from '@crewdeck/contracts';
import { emitAction, PageProjets, RepositoryPicker } from '@crewdeck/sdk';
import type { z } from 'zod';
import { createDispatcher } from './actions/dispatcher.js';
import type { Client } from './api/client.js';
import { boot, type App } from './app.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' };
const AT = '2026-11-12T09:00:00.000Z';
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
  releaseBranch: 'main',
  integrationBranch: 'develop',
  hasCode: true,
  inventoryState: 'pending',
  accessLost: false,
  followedAt: AT,
};

type WithData = HTMLElement & { data: Record<string, unknown> };

describe('« Projets » in the page', () => {
  let app: App;
  let root: HTMLElement;
  const commands: { path: string; body: object }[] = [];
  let answer: () => Promise<unknown> = async () => ({ items: [PROJECT] });
  const store = createStore();
  store.registerSlice('pilot', { shape: 'single' });
  store.registerSlice('project', { shape: 'collection', snapshotKey: 'projects' });
  store.registerSlice('repository', { shape: 'collection', snapshotKey: 'repositories' });
  const client: Pick<Client, 'command' | 'query'> = {
    query: (async () => ({ githubApiUrl: 'https://api.github.example', githubWebUrl: 'https://github.example', appSlug: 'crewdeck', runnerServer: null })) as Client['query'],
    command: (async (_method: string, path: string, body: object, schema?: z.ZodType) => {
      commands.push({ path, body });
      return schema?.parse(await answer());
    }) as Client['command'],
  };
  const page = (tag: string) => root.querySelector<WithData>(tag);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeAll(async () => {
    history.replaceState(null, '', '/projets');
    root = document.createElement('div');
    document.body.append(root);
    app = await boot({ root, dispatcher: createDispatcher(), me: async () => PILOT, store, client, connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() } });
  });

  afterAll(() => app.stop());

  it('opens /projets on the list, empty before any Projet', () => {
    expect(location.pathname).toBe('/projets');
    expect(page('cd-page-projets')?.data).toEqual({ projects: [] });
  });

  it('follows the store: a Projet followed appears in real time', () => {
    store.applySnapshot({ seq: 1, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [], devices: [], projects: [], repositories: [REPOSITORY] });
    store.applyEvent({ seq: 2, type: 'project.upserted', payload: PROJECT, at: AT });

    expect(page('cd-page-projets')?.data).toEqual({ projects: [{ id: PROJECT.id, displayName: 'Site de la mairie', fullName: 'octocat/site-mairie' }] });
    store.applyEvent({ seq: 3, type: 'project.removed', payload: { id: PROJECT.id }, at: AT });
  });

  it('« Ajouter un Projet » opens the picker, with the repositories not followed and GitHub’s installation page', async () => {
    emitAction(page('cd-page-projets') as HTMLElement, PageProjets, 'add', {});
    await settle();

    expect(location.pathname).toBe('/projets/ajouter');
    expect(page('cd-repository-picker')?.data).toEqual({
      context: 'projets',
      repositories: [{ id: REPOSITORY.id, fullName: 'octocat/site-mairie', hasCode: true }],
      installUrl: 'https://github.example/apps/crewdeck/installations/new?state=projets',
      busy: false,
    });
  });

  it('following posts the repositories, the picker busy meanwhile, then shows the list', async () => {
    let release: () => void = () => undefined;
    answer = () =>
      new Promise((resolve) => {
        release = () => resolve({ items: [PROJECT] });
      });
    emitAction(page('cd-repository-picker') as HTMLElement, RepositoryPicker, 'follow', { repositoryIds: [REPOSITORY.id] });
    await settle();

    expect(commands).toEqual([{ path: '/api/projects', body: { repositoryIds: [REPOSITORY.id] } }]);
    expect(page('cd-repository-picker')?.data).toMatchObject({ busy: true });

    release();
    await settle();

    expect(location.pathname).toBe('/projets');
  });
});
