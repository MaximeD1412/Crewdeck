import type { Repository } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Client } from './api/client.js';
import { createProjects } from './projects.js';
import { createStore } from './store/store.js';

const REPOSITORY: Repository = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a81',
  owner: 'octocat',
  name: 'site-mairie',
  fullName: 'octocat/site-mairie',
  private: true,
  defaultBranch: 'main',
  hasCode: false,
  followed: false,
};
const CONFIG = { githubApiUrl: 'https://api.github.example', githubWebUrl: 'https://github.example', appSlug: 'crewdeck', runnerServer: null };

const setup = (command: () => Promise<unknown>, query: () => Promise<unknown> = async () => CONFIG) => {
  const store = createStore();
  store.registerSlice('repository', { shape: 'collection', snapshotKey: 'repositories' });
  const client: Pick<Client, 'command' | 'query'> = {
    query: (async () => query()) as Client['query'],
    command: (async (_method: string, _path: string, _body: object, schema?: z.ZodType) => schema?.parse(await command())) as Client['command'],
  };
  const projects = createProjects({ store, client });
  const changes = vi.fn<() => void>();
  projects.subscribe(changes);
  return { store, projects, changes };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createProjects', () => {
  it('gives the picker no installation link until the config is read, then the one coming back to its context', async () => {
    const { projects, changes } = setup(async () => ({ items: [] }));

    expect(projects.picker('demarrage')).toMatchObject({ context: 'demarrage', repositories: [], installUrl: null, busy: false });
    await settle();

    expect(changes).toHaveBeenCalled();
    expect(projects.picker('demarrage').installUrl).toBe('https://github.example/apps/crewdeck/installations/new?state=demarrage');
  });

  it('leaves the link out when the config cannot be read, and reads it again on the next render', async () => {
    let fails = true;
    const { projects } = setup(
      async () => ({ items: [] }),
      async () => {
        if (fails) throw new Error('offline');
        return CONFIG;
      },
    );
    projects.picker('projets');
    await settle();
    expect(projects.picker('projets').installUrl).toBeNull();
    await settle();

    fails = false;
    projects.picker('projets');
    await settle();
    expect(projects.picker('projets').installUrl).toBe('https://github.example/apps/crewdeck/installations/new?state=projets');
  });

  it('reads the repositories from the store', () => {
    const { store, projects } = setup(async () => ({ items: [] }));
    store.applySnapshot({ seq: 1, pilot: null, runner: null, 'runner-link': null, 'ai-account': [], devices: [], projects: [], repositories: [REPOSITORY] } as never);

    expect(projects.picker('projets').repositories).toEqual([{ id: REPOSITORY.id, fullName: 'octocat/site-mairie', hasCode: false }]);
  });

  it('a refused follow is thrown to the page, the picker no longer busy', async () => {
    const { projects } = setup(async () => {
      throw new Error('refused');
    });

    const following = projects.follow([REPOSITORY.id]);
    expect(projects.picker('projets').busy).toBe(true);

    await expect(following).rejects.toThrow('refused');
    expect(projects.picker('projets').busy).toBe(false);
  });

  it('follows one batch at a time', async () => {
    let release: () => void = () => undefined;
    const command = vi.fn(() => new Promise((resolve) => (release = () => resolve({ items: [] }))));
    const { projects } = setup(command);

    const first = projects.follow([REPOSITORY.id]);
    await projects.follow([REPOSITORY.id]);
    release();
    await first;

    expect(command).toHaveBeenCalledTimes(1);
  });
});
