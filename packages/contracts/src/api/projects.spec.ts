import { eventPayloadSchema, STATE_SLICES, zFollowProjects, zProject, zProjectList, zRepository } from '../index.js';

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
  followedAt: '2026-11-12T08:30:00.000Z',
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

  it('keeps an Inventaire in one of its states', () => {
    expect(zProject.safeParse({ ...PROJECT, inventoryState: 'done' }).success).toBe(false);
    expect(zRepository.safeParse({ ...REPOSITORY, hasCode: undefined }).success).toBe(false);
  });
});

describe('zFollowProjects', () => {
  it('follows 1 to 20 Dépôts GitHub, with the seq of the page', () => {
    expect(zFollowProjects.parse({ repositoryIds: [REPOSITORY.id], seq: '12' })).toEqual({ repositoryIds: [REPOSITORY.id], seq: 12 });
    expect(zFollowProjects.safeParse({ repositoryIds: [], seq: 1 }).success).toBe(false);
    expect(zFollowProjects.safeParse({ repositoryIds: Array.from({ length: 21 }, () => REPOSITORY.id), seq: 1 }).success).toBe(false);
    expect(zFollowProjects.safeParse({ repositoryIds: ['personal-os'], seq: 1 }).success).toBe(false);
  });
});
