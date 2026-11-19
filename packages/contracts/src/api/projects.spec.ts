import { eventPayloadSchema, STATE_SLICES, zAttachProjectFolder, zCreateLocalProject, zFollowProjects, zProcessTemplateId, zProject, zProjectList, zRepository } from '../index.js';

const SEALED = { key: 'A'.repeat(80), ciphertext: 'B'.repeat(43) };

const REPOSITORY = {
  id: '019a6f00-0000-7000-8000-000000000001',
  owner: 'octocat',
  name: 'personal-os',
  fullName: 'octocat/personal-os',
  private: true,
  defaultBranch: 'main',
  hasCode: true,
  followed: false,
};

const PROJECT = {
  id: '019a6f00-0000-7000-8000-000000000011',
  repositoryId: REPOSITORY.id,
  owner: 'octocat',
  name: 'personal-os',
  fullName: 'octocat/personal-os',
  displayName: 'Personal OS',
  releaseBranch: 'main',
  integrationBranch: 'develop',
  hasCode: true,
  inventoryState: 'pending',
  accessLost: false,
  nameSealed: null,
  folder: null,
  followedAt: '2026-11-12T08:30:00.000Z',
};

/** A Local Projet: no repository, its name sealed, its folder on the Runner. */
const LOCAL_PROJECT = {
  ...PROJECT,
  id: '019a6f00-0000-7000-8000-000000000021',
  repositoryId: null,
  owner: null,
  name: null,
  fullName: null,
  displayName: null,
  nameSealed: SEALED,
  folder: 'pending',
};

describe('zRepository and zProject', () => {
  it('are the payloads of repository.upserted and project.upserted, and the items of their slices', () => {
    expect(eventPayloadSchema('repository.upserted')?.parse(REPOSITORY)).toEqual(REPOSITORY);
    expect(eventPayloadSchema('project.upserted')?.parse(PROJECT)).toEqual(PROJECT);
    expect(eventPayloadSchema('repository.removed')?.parse({ id: REPOSITORY.id })).toEqual({ id: REPOSITORY.id });
    expect(STATE_SLICES.repositories.parse([REPOSITORY])).toEqual([REPOSITORY]);
    expect(STATE_SLICES.projects.parse([PROJECT])).toEqual([PROJECT]);
    expect(zProjectList.parse({ items: [PROJECT] })).toEqual({ items: [PROJECT] });
  });

  it('holds a Local Projet: no repository nor name in clear, its name sealed, its folder pending, present or missing', () => {
    expect(eventPayloadSchema('project.upserted')?.parse(LOCAL_PROJECT)).toEqual(LOCAL_PROJECT);
    expect(zProject.safeParse({ ...LOCAL_PROJECT, folder: 'gone' }).success).toBe(false);
    expect(zProject.safeParse({ ...LOCAL_PROJECT, nameSealed: { key: 'x', ciphertext: 'y' } }).success).toBe(false);
  });

  it('keeps an Inventaire in one of its states', () => {
    expect(zProject.safeParse({ ...PROJECT, inventoryState: 'done' }).success).toBe(false);
    expect(zRepository.safeParse({ ...REPOSITORY, hasCode: undefined }).success).toBe(false);
  });
});

describe('zFollowProjects', () => {
  it('follows 1 to 20 Dépôts GitHub, with the seq of the page', () => {
    expect(zFollowProjects.parse({ repositoryIds: [REPOSITORY.id], templateId: 'process-crewdeck', seq: '12' })).toEqual({
      repositoryIds: [REPOSITORY.id],
      templateId: 'process-crewdeck',
      seq: 12,
    });
    expect(zFollowProjects.safeParse({ repositoryIds: [], seq: 1 }).success).toBe(false);
    expect(zFollowProjects.safeParse({ repositoryIds: Array.from({ length: 21 }, () => REPOSITORY.id), seq: 1 }).success).toBe(false);
    expect(zFollowProjects.safeParse({ repositoryIds: ['personal-os'], seq: 1 }).success).toBe(false);
  });

  it('starts from a Modèle de process: « Process Crewdeck » only, until PROCESS-14', () => {
    expect(zProcessTemplateId.options).toEqual(['process-crewdeck']);
    expect(zFollowProjects.safeParse({ repositoryIds: [REPOSITORY.id], templateId: 'mon-process', seq: 1 }).success).toBe(false);
  });
});

describe('zCreateLocalProject and zAttachProjectFolder', () => {
  const CREATE = { id: LOCAL_PROJECT.id, nameSealed: SEALED, folderSealed: SEALED, vaultKeyVersion: 2, hasCode: true, releaseBranch: 'main', templateId: 'process-crewdeck' };

  it('creates a Local Projet of an id the page drew, its name and its folder sealed', () => {
    expect(zCreateLocalProject.parse(CREATE)).toEqual(CREATE);
    expect(zCreateLocalProject.parse({ ...CREATE, releaseBranch: null }).releaseBranch).toBeNull();
    expect(zCreateLocalProject.safeParse({ ...CREATE, id: 'recettes' }).success).toBe(false);
    expect(zCreateLocalProject.safeParse({ ...CREATE, folderSealed: '~/projets/recettes' }).success).toBe(false);
    expect(zCreateLocalProject.safeParse({ ...CREATE, templateId: undefined }).success).toBe(false);
    // The version of the vault key they were sealed under, always.
    expect(zCreateLocalProject.safeParse({ ...CREATE, vaultKeyVersion: undefined }).success).toBe(false);
    expect(zCreateLocalProject.safeParse({ ...CREATE, vaultKeyVersion: 0 }).success).toBe(false);
  });

  it('attaches a folder again, with the seq of the page and the version it was sealed under', () => {
    expect(zAttachProjectFolder.parse({ folderSealed: SEALED, vaultKeyVersion: 2, seq: '3' })).toEqual({ folderSealed: SEALED, vaultKeyVersion: 2, seq: 3 });
    expect(zAttachProjectFolder.safeParse({ folderSealed: SEALED, vaultKeyVersion: 2 }).success).toBe(false);
    expect(zAttachProjectFolder.safeParse({ folderSealed: SEALED, seq: '3' }).success).toBe(false);
  });
});
