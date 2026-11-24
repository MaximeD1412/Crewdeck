import { projectFolderAad, projectNameAad, type Project } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Client } from '../api/client.js';
import { ApiError } from '../api/request.js';
import { fromBase64Url } from '../keys/bytes.js';
import { attachFolder, createLocalProject, pickSourceFolder } from './local.js';
import { fakeVault } from './testing.js';

const ID = '019a6f00-0000-7000-8000-000000000021';
const AT = '2026-11-12T09:00:00.000Z';

const opened = (item: { ciphertext: string }) => new TextDecoder().decode(fromBase64Url(item.ciphertext));

const versionChanged = () => new ApiError({ status: 409, code: 'vault.version-changed', message: 'La clé du coffre a déjà changé : relis le coffre avant de recommencer.' });

/** `refused`: how many first posts the server answers 409 `vault.version-changed`, as after a rotation. */
const setup = (refused = 0) => {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const vault = fakeVault();
  const client = {
    command: (async (method: string, path: string, body: Record<string, unknown>, schema?: z.ZodType) => {
      calls.push({ method, path, body });
      if (calls.length <= refused) {
        // Another holder rotated: the page unlocks again, under version 2.
        vault.version = 2;
        throw versionChanged();
      }
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
  return { calls, vault, deps: { client, vault, newId: () => ID } };
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
    expect(call).toMatchObject({ method: 'POST', path: '/api/projects/local', body: { id: ID, vaultKeyVersion: 1, hasCode: true, releaseBranch: 'main', templateId: 'process-crewdeck' } });
    expect(opened(call?.body['nameSealed'] as { ciphertext: string })).toBe(`${projectNameAad(ID)}Recettes`);
    expect(opened(call?.body['folderSealed'] as { ciphertext: string })).toBe(`${projectFolderAad(ID)}{"path":"~/projets/recettes"}`);
    expect(JSON.stringify(call?.body)).not.toMatch(/recettes|Recettes/);
  });

  it('after a rotation, unlocks the vault and seals the name and the path again under its new version, once', async () => {
    const { calls, vault, deps } = setup(1);
    const input = { path: '~/projets/recettes', name: 'Recettes', templateId: 'process-crewdeck', check: { state: 'ready', hasCode: true, branch: 'main', name: 'recettes' } } as const;

    expect(await createLocalProject(deps, input)).toMatchObject({ id: ID });
    expect(vault.unlocks).toBe(1);
    expect(calls.map((call) => call.body['vaultKeyVersion'])).toEqual([1, 2]);
    expect(calls[1]?.body['id']).toBe(ID);

    // Refused again: the refusal is the caller's, with no third post.
    const twice = setup(2);
    await expect(createLocalProject(twice.deps, input)).rejects.toMatchObject({ code: 'vault.version-changed' });
    expect(twice.calls).toHaveLength(2);
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

    expect(calls[0]).toMatchObject({ method: 'POST', path: `/api/projects/${ID}/folder`, body: { vaultKeyVersion: 1, seq: 12n } });
    expect(opened(calls[0]?.body['folderSealed'] as { ciphertext: string })).toBe(`${projectFolderAad(ID)}{"path":"~/projets/recettes"}`);
  });

  it('after a rotation, seals the path again under the new version, once', async () => {
    const { calls, vault, deps } = setup(1);

    await attachFolder(deps, ID, '~/projets/recettes', 12n);

    expect(vault.unlocks).toBe(1);
    expect(calls.map((call) => call.body['vaultKeyVersion'])).toEqual([1, 2]);
  });
});

describe('pickSourceFolder (SOURCE-9)', () => {
  it('posts the folder a migration to Local will use, sealed as the Projet’s, to its group’s route, sealed again once after a rotation', async () => {
    const { calls, vault, deps } = setup(1);

    await pickSourceFolder(deps, ID, 'code', '~/projets/mairie');

    expect(calls.map(({ method, path }) => [method, path])).toEqual([
      ['POST', `/api/projects/${ID}/sources/code/folder`],
      ['POST', `/api/projects/${ID}/sources/code/folder`],
    ]);
    expect(vault.unlocks).toBe(1);
    expect(calls[1]?.body).toEqual({ folderSealed: expect.anything(), vaultKeyVersion: 2 });
    expect(opened(calls[1]?.body['folderSealed'] as { ciphertext: string })).toBe(`${projectFolderAad(ID)}{"path":"~/projets/mairie"}`);
  });
});
