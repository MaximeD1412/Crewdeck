import { projectFolderAad, projectNameAad, type Project } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Client } from '../api/client.js';
import { fromBase64Url } from '../keys/bytes.js';
import { attachFolder, createLocalProject } from './local.js';
import { fakeVault } from './testing.js';

const ID = '019a6f00-0000-7000-8000-000000000021';
const AT = '2026-11-12T09:00:00.000Z';

const opened = (item: { ciphertext: string }) => new TextDecoder().decode(fromBase64Url(item.ciphertext));

const setup = () => {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const client = {
    command: (async (method: string, path: string, body: Record<string, unknown>, schema?: z.ZodType) => {
      calls.push({ method, path, body });
      const project: Project = {
        id: path.includes('/folder') ? ID : (body['id'] as string),
        repositoryId: null,
        owner: null,
        name: null,
        fullName: null,
        displayName: null,
        nameSealed: (body['nameSealed'] as Project['nameSealed']) ?? { key: 'A'.repeat(80), ciphertext: 'B'.repeat(40) },
        folder: 'pending',
        releaseBranch: 'main',
        integrationBranch: 'develop',
        hasCode: true,
        inventoryState: 'pending',
        accessLost: false,
        followedAt: AT,
      };
      return schema?.parse(project);
    }) as Client['command'],
  };
  return { calls, deps: { client, vault: fakeVault(), newId: () => ID } };
};

describe('createLocalProject', () => {
  it('draws the id, seals the name and the path for it, and posts the check’s code and branch with the Modèle', async () => {
    const { calls, deps } = setup();

    const project = await createLocalProject(deps, {
      path: '~/projets/recettes',
      name: 'Recettes',
      templateId: 'process-crewdeck',
      check: { state: 'ready', hasCode: true, branch: 'main', name: 'recettes' },
    });

    expect(project).toMatchObject({ id: ID, folder: 'pending' });
    const [call] = calls;
    expect(call).toMatchObject({ method: 'POST', path: '/api/projects/local', body: { id: ID, hasCode: true, releaseBranch: 'main', templateId: 'process-crewdeck' } });
    expect(opened(call?.body['nameSealed'] as { ciphertext: string })).toBe(`${projectNameAad(ID)}Recettes`);
    expect(opened(call?.body['folderSealed'] as { ciphertext: string })).toBe(`${projectFolderAad(ID)}{"path":"~/projets/recettes"}`);
    expect(JSON.stringify(call?.body)).not.toMatch(/recettes|Recettes/);
  });

  it('a folder without git has no branch', async () => {
    const { calls, deps } = setup();

    await createLocalProject(deps, { path: '/srv/notes', name: 'Notes', templateId: 'process-crewdeck', check: { state: 'not-git', hasCode: false, branch: null, name: 'notes' } });

    expect(calls[0]?.body).toMatchObject({ hasCode: false, releaseBranch: null });
  });
});

describe('attachFolder', () => {
  it('posts the path sealed for the Projet, with the `seq` given', async () => {
    const { calls, deps } = setup();

    await attachFolder(deps, ID, '~/projets/recettes', 12n);

    expect(calls[0]).toMatchObject({ method: 'POST', path: `/api/projects/${ID}/folder`, body: { seq: 12n } });
    expect(opened(calls[0]?.body['folderSealed'] as { ciphertext: string })).toBe(`${projectFolderAad(ID)}{"path":"~/projets/recettes"}`);
  });
});
