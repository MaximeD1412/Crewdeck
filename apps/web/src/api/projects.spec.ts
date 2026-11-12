import type { z } from 'zod';
import type { Client } from './client.js';
import { followProjects, installUrl } from './projects.js';

const PROJECT = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a80',
  repositoryId: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a81',
  owner: 'maxime',
  name: 'personal-os',
  fullName: 'maxime/personal-os',
  displayName: 'personal-os',
  releaseBranch: 'main',
  integrationBranch: 'develop',
  hasCode: true,
  inventoryState: 'pending',
  accessLost: false,
  followedAt: '2026-11-12T09:00:00.000Z',
};

describe('followProjects', () => {
  it('posts the repositories to follow and answers the Projets created', async () => {
    const calls: unknown[] = [];
    const client = {
      command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
        calls.push({ method, path, body });
        return schema?.parse({ items: [PROJECT] });
      }) as Client['command'],
    };

    await expect(followProjects(client, [PROJECT.repositoryId])).resolves.toEqual([PROJECT]);
    expect(calls).toEqual([{ method: 'POST', path: '/api/projects', body: { repositoryIds: [PROJECT.repositoryId] } }]);
  });
});

describe('installUrl', () => {
  it('is GitHub’s installation page of the App, coming back where the Pilote was', () => {
    expect(installUrl({ githubWebUrl: 'https://github.example/', appSlug: 'crewdeck-staging' }, 'demarrage')).toBe(
      'https://github.example/apps/crewdeck-staging/installations/new?state=demarrage',
    );
    expect(installUrl({ githubWebUrl: 'https://github.example', appSlug: 'crewdeck' }, 'projets')).toBe('https://github.example/apps/crewdeck/installations/new?state=projets');
  });
});
