import { MIRROR_TOKEN_PERMISSIONS, type MirrorProject } from '@crewdeck/contracts';
import { FakeGitHub } from '../../testing/fake-github.js';
import { mirrorTokens } from './mirror-token.js';

const project = (n: number, installationId: number): MirrorProject => ({
  projectId: `019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a0${n}`,
  repository: `octo-fixture/app-${n}`,
  githubRepoId: 71000000 + n,
  installationId,
  displayName: `App ${n}`,
  integrationBranch: 'develop',
});

describe('mirrorTokens, the « Miroir » tokens of the Pilote’s Projets', () => {
  let github: FakeGitHub;

  beforeEach(() => {
    github = new FakeGitHub();
    github.seedInstallation(51000001);
    github.seedInstallation(51000002);
  });

  it('asks one token per installation, restricted to its repositories and the six read permissions', async () => {
    const answer = await mirrorTokens(github, [project(1, 51000001), project(2, 51000002), project(3, 51000001)]);

    expect(github.calls).toEqual([
      { method: 'installationToken', args: [51000001, { repositoryIds: [71000001, 71000003], permissions: MIRROR_TOKEN_PERMISSIONS }] },
      { method: 'installationToken', args: [51000002, { repositoryIds: [71000002], permissions: MIRROR_TOKEN_PERMISSIONS }] },
    ]);
    expect(answer).toEqual({
      type: 'mirror.token.issued',
      tokens: [
        { installationId: 51000001, token: expect.stringMatching(/^ghs_fake_51000001_/), expiresAt: expect.any(String), repositories: ['octo-fixture/app-1', 'octo-fixture/app-3'] },
        { installationId: 51000002, token: expect.stringMatching(/^ghs_fake_51000002_/), expiresAt: expect.any(String), repositories: ['octo-fixture/app-2'] },
      ],
    });
  });

  it('never asks a write permission, nor the whole installation', async () => {
    await mirrorTokens(github, [project(1, 51000001)]);

    const [call] = github.calls;
    const options = call?.args[1] as { repositoryIds?: number[]; permissions?: Record<string, string> };
    expect(options.repositoryIds).toEqual([71000001]);
    expect(Object.values(options.permissions ?? {})).toEqual(['read', 'read', 'read', 'read', 'read', 'read']);
  });

  it('answers tokens: [] without asking GitHub when the Pilote has no Projet', async () => {
    expect(await mirrorTokens(github, [])).toEqual({ type: 'mirror.token.issued', tokens: [] });
    expect(github.calls).toEqual([]);
  });

  it('answers mirror.token.failed with github.unavailable when GitHub refuses one installation', async () => {
    expect(await mirrorTokens(github, [project(1, 51000001), project(2, 51000009)])).toEqual({ type: 'mirror.token.failed', code: 'github.unavailable' });
  });
});
