import { processSealAad, projectNameAad, templateSealAad, type ProcessTemplate, type Project, type Repository } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { toBase64Url } from './keys/bytes.js';
import type { VaultState } from './keys/vault.js';
import { createProjectNames, createProjects } from './projects.js';
import { fakeSealed, fakeVault } from './projects/testing.js';
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

const setup = (command: (body: object) => Promise<unknown>, query: () => Promise<unknown> = async () => CONFIG) => {
  const store = createStore();
  store.registerSlice('repository', { shape: 'collection', snapshotKey: 'repositories' });
  store.registerSlice('process-template', { shape: 'collection', snapshotKey: 'processTemplates' });
  const client: Pick<Client, 'command' | 'query'> = {
    query: (async () => query()) as Client['query'],
    command: (async (_method: string, _path: string, body: object, schema?: z.ZodType) => schema?.parse(await command(body))) as Client['command'],
  };
  const ids = ['019a6f00-0000-7000-8000-000000000031', '019a6f00-0000-7000-8000-000000000032'];
  const vault = fakeVault();
  const projects = createProjects({ store, client, vault, newId: () => ids.shift() ?? '' });
  const changes = vi.fn<() => void>();
  projects.subscribe(changes);
  return { store, projects, changes, vault };
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
    store.applySnapshot({ seq: 1, pilot: null, runner: null, 'runner-link': null, 'ai-account': [], 'mcp-server': [], devices: [], 'push-subscriptions': [], vault: { version: 1, rotationPending: false }, sourceMigrations: [], projects: [], processes: [], processTemplates: [], phaseRuns: [], stepRuns: [], repositories: [REPOSITORY], decisions: [], ideas: [], tickets: [], milestones: [], codeChanges: [], usage: [], sessions: [] } as never);

    expect(projects.picker('projets').repositories).toEqual([{ id: REPOSITORY.id, fullName: 'octocat/site-mairie', hasCode: false }]);
  });

  it('a refused follow is thrown to the page, the picker no longer busy', async () => {
    const { projects } = setup(async () => {
      throw new Error('refused');
    });

    const following = projects.follow([REPOSITORY.id], 'process-crewdeck');
    expect(projects.picker('projets').busy).toBe(true);

    await expect(following).rejects.toThrow('refused');
    expect(projects.picker('projets').busy).toBe(false);
  });

  it('follows one batch at a time', async () => {
    let release: () => void = () => undefined;
    const command = vi.fn(() => new Promise((resolve) => (release = () => resolve({ items: [] }))));
    const { projects } = setup(command);

    const first = projects.follow([REPOSITORY.id], 'process-crewdeck');
    await projects.follow([REPOSITORY.id], 'process-crewdeck');
    release();
    await first;

    expect(command).toHaveBeenCalledTimes(1);
  });

  it('follows with the Modèle de process chosen, and refuses one it does not know', async () => {
    const command = vi.fn<(body: object) => Promise<unknown>>(async () => ({ items: [] }));
    const { projects } = setup(command);

    await projects.follow([REPOSITORY.id], 'process-crewdeck');
    expect(command.mock.calls[0]?.[0]).toMatchObject({ repositoryIds: [REPOSITORY.id], templateId: 'process-crewdeck' });

    await expect(projects.follow([REPOSITORY.id], 'autre')).rejects.toThrow();
    expect(command).toHaveBeenCalledTimes(1);
    expect(projects.picker('projets')).toMatchObject({ busy: false, templates: [{ id: 'process-crewdeck', label: 'Process Crewdeck' }], templateId: 'process-crewdeck' });
  });
});

describe('createProjects, from one of the Pilote’s Modèles (PROCESS-14)', () => {
  const OTHER: Repository = { ...REPOSITORY, id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a82', name: 'atelier', fullName: 'octocat/atelier' };
  const COMMANDS = JSON.stringify({ e2e: 'pnpm exec playwright test' });
  const template = (id: string, name: string, sealed: ProcessTemplate['sealed'], revision = 1): ProcessTemplate => ({
    id,
    name,
    fromProjectId: null,
    fromVersionNumber: 3,
    sealed,
    commandCount: sealed === null ? 0 : 1,
    revision,
    createdAt: '2026-11-12T09:00:00.000Z',
    updatedAt: '2026-11-12T09:00:00.000Z',
  });
  const WEB = '019a6f00-0000-7000-8000-0000000000a1';
  const COURT = '019a6f00-0000-7000-8000-0000000000a2';
  const withTemplates = async (store: ReturnType<typeof setup>['store']) => {
    const templates = [template(WEB, 'Process web', await fakeSealed(COMMANDS, templateSealAad(WEB)), 2), template(COURT, 'Process court', null)];
    store.applySnapshot({ seq: 1, repositories: [REPOSITORY, OTHER], processTemplates: templates } as never);
  };

  it('offers « Process Crewdeck », then the Pilote’s Modèles by name; one with Commandes disabled while the vault is locked', async () => {
    const { store, projects } = setup(async () => ({ items: [] }));
    await withTemplates(store);
    expect(projects.picker('projets')).toMatchObject({
      templates: [
        { id: 'process-crewdeck', label: 'Process Crewdeck' },
        { id: COURT, label: 'Process court' },
        { id: WEB, label: 'Process web', disabled: true },
      ],
      templateId: 'process-crewdeck',
    });
    store.setVaultState('unlocked');
    expect(projects.picker('projets').templates).toEqual([
      { id: 'process-crewdeck', label: 'Process Crewdeck' },
      { id: COURT, label: 'Process court' },
      { id: WEB, label: 'Process web' },
    ]);
  });

  it('draws each Projet’s id, and seals the Modèle’s Commandes again for each, under process:<id>, with its revision and the key’s version', async () => {
    const command = vi.fn<(body: object) => Promise<unknown>>(async () => ({ items: [] }));
    const { store, projects } = setup(command);
    await withTemplates(store);

    await projects.follow([REPOSITORY.id, OTHER.id], WEB);
    expect(command.mock.calls[0]?.[0]).toEqual({
      repositoryIds: [REPOSITORY.id, OTHER.id],
      templateId: WEB,
      templateRevision: 2,
      vaultKeyVersion: 1,
      projects: [
        { repositoryId: REPOSITORY.id, id: '019a6f00-0000-7000-8000-000000000031', templateSealed: await fakeSealed(COMMANDS, processSealAad('019a6f00-0000-7000-8000-000000000031')) },
        { repositoryId: OTHER.id, id: '019a6f00-0000-7000-8000-000000000032', templateSealed: await fakeSealed(COMMANDS, processSealAad('019a6f00-0000-7000-8000-000000000032')) },
      ],
    });
  });

  it('a Modèle without Commandes gives each Projet its id, nothing sealed', async () => {
    const command = vi.fn<(body: object) => Promise<unknown>>(async () => ({ items: [] }));
    const { store, projects } = setup(command);
    await withTemplates(store);

    await projects.follow([REPOSITORY.id], COURT);
    expect(command.mock.calls[0]?.[0]).toEqual({
      repositoryIds: [REPOSITORY.id],
      templateId: COURT,
      templateRevision: 1,
      projects: [{ repositoryId: REPOSITORY.id, id: '019a6f00-0000-7000-8000-000000000031', templateSealed: null }],
    });
  });

  it('after a rotation, unlocks the vault and seals the Commandes again under its new version, the same ids, once (E2E-4)', async () => {
    const versionChanged = new ApiError({ status: 409, code: 'vault.version-changed', message: 'La clé du coffre a déjà changé.' });
    let refused = 1;
    const command = vi.fn<(body: object) => Promise<unknown>>(async () => {
      if (refused-- > 0) {
        // Another holder rotated while the page sealed: the vault opens again under version 2.
        vault.version = 2;
        throw versionChanged;
      }
      return { items: [] };
    });
    const { store, projects, vault } = setup(command);
    await withTemplates(store);

    await projects.follow([REPOSITORY.id], WEB);
    expect(vault.unlocks).toBe(1);
    const bodies = command.mock.calls.map(([body]) => body as { vaultKeyVersion: number; projects: { id: string }[] });
    expect(bodies.map((body) => body.vaultKeyVersion)).toEqual([1, 2]);
    expect(bodies.map((body) => body.projects[0]?.id)).toEqual(['019a6f00-0000-7000-8000-000000000031', '019a6f00-0000-7000-8000-000000000031']);
  });
});

describe('createProjectNames', () => {
  const ID = '019a6f00-0000-7000-8000-000000000021';
  const local = async (name: string, aad = projectNameAad(ID)): Promise<Pick<Project, 'id' | 'displayName' | 'nameSealed'>> => ({
    id: ID,
    displayName: null,
    nameSealed: await fakeSealed(name, aad),
  });
  const setupNames = (initial: VaultState = 'unlocked') => {
    let state = initial;
    const names = createProjectNames({ vault: fakeVault(), vaultState: () => state });
    const changes = vi.fn<() => void>();
    names.subscribe(changes);
    return { names, changes, lock: (next: VaultState) => (state = next) };
  };

  it('names a Dépôt GitHub’s Projet by its `displayName`', () => {
    expect(setupNames('locked').names.projectName({ id: ID, displayName: 'Personal OS', nameSealed: null })).toBe('Personal OS');
  });

  it('opens a Local Projet’s name once, « Projet local » meanwhile, and tells the page', async () => {
    const { names, changes } = setupNames();
    const project = await local('Recettes');

    expect(names.projectName(project)).toBe('Projet local');
    await settle();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(names.projectName(project)).toBe('Recettes');

    const renamed = await local('Cuisine');
    expect(names.projectName(renamed)).toBe('Projet local');
    await settle();
    expect(names.projectName(renamed)).toBe('Cuisine');
  });

  it('is « Projet local » while the vault is locked, and for a name that is not this vault’s', async () => {
    const { names, lock } = setupNames('locked');
    const project = await local('Recettes');
    expect(names.projectName(project)).toBe('Projet local');

    lock('unlocked');
    names.projectName(project);
    await settle();
    expect(names.projectName(project)).toBe('Recettes');

    const other = await local('Ailleurs', projectNameAad('019a6f00-0000-7000-8000-000000000099'));
    names.projectName(other);
    await settle();
    expect(names.projectName(other)).toBe('Projet local');
  });

  it('opens again a name whose item key was rewrapped by a rotation, its ciphertext the same (E2E-4)', async () => {
    const { names } = setupNames();
    const rewrapped = await local('Recettes');
    // The state read before the rotation: the key wrapped under the old vault key, which the vault opened since no longer opens.
    const stale = { ...rewrapped, nameSealed: { key: toBase64Url(new Uint8Array(60)), ciphertext: rewrapped.nameSealed?.ciphertext ?? '' } };
    names.projectName(stale);
    await settle();
    expect(names.projectName(stale)).toBe('Projet local');

    // The Resynchronisation brings the rewrapped key.
    expect(names.projectName(rewrapped)).toBe('Projet local');
    await settle();
    expect(names.projectName(rewrapped)).toBe('Recettes');
  });
});
