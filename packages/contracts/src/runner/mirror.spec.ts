import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GITHUB_CHANGE_KINDS, zGitHubChange, zGitHubChanged, zHello, zMirrorLive, zMirrorProjects, zServerToRunner } from '../index.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/runner');
const fixture = <T = Record<string, unknown>>(type: string): T => JSON.parse(readFileSync(join(FIXTURES, `${type}.json`), 'utf8')) as T;

const change = (): Record<string, unknown> => fixture<{ change: Record<string, unknown> }>('github.changed').change;

describe('the Miroir’s messages', () => {
  it('names the seven kinds of a change of GitHub', () => {
    expect(GITHUB_CHANGE_KINDS).toEqual(['issue', 'pull', 'push', 'check', 'release', 'label', 'milestone']);
  });

  it('carries an envelope of identifiers, states and dates only: any other key is refused', () => {
    expect(Object.keys(zGitHubChange.parse(change())).sort()).toEqual(['action', 'at', 'kind', 'number', 'projectId', 'ref', 'repository', 'seq', 'sha'].sort());
    expect(zGitHubChange.safeParse({ ...change(), title: 'Connexion GitHub' }).success).toBe(false);
    expect(zGitHubChanged.safeParse({ ...fixture<Record<string, unknown>>('github.changed'), change: { ...change(), body: 'texte' } }).success).toBe(false);
  });

  it('gives null, never absent, to what a webhook does not say', () => {
    const push = { ...change(), kind: 'push', number: null, action: null, ref: 'refs/heads/develop' };
    expect(zGitHubChange.parse(push)).toMatchObject({ number: null, action: null });
    const withoutNumber: Record<string, unknown> = { ...change() };
    delete withoutNumber['number'];
    expect(zGitHubChange.safeParse(withoutNumber).success).toBe(false);
  });

  it('refuses a repository not named <owner>/<name>, a sha not of 40 hex, a kind of its own', () => {
    expect(zGitHubChange.safeParse({ ...change(), repository: 'fixture-app' }).success).toBe(false);
    expect(zGitHubChange.safeParse({ ...change(), sha: 'abc' }).success).toBe(false);
    expect(zGitHubChange.safeParse({ ...change(), kind: 'discussion' }).success).toBe(false);
  });

  it('lets a hello say mirrorAfter, a seq or null, or leave it out (a Runner without a Miroir)', () => {
    const hello = fixture('hello');
    expect(zHello.parse(hello).mirrorAfter).toBeUndefined();
    expect(zHello.parse({ ...hello, mirrorAfter: null }).mirrorAfter).toBeNull();
    expect(zHello.parse({ ...hello, mirrorAfter: 3 }).mirrorAfter).toBe(3);
    expect(zHello.safeParse({ ...hello, mirrorAfter: -1 }).success).toBe(false);
  });

  it('ends a replay with mirror.live and its seq, and lists the Projets with their repository and branch', () => {
    expect(zMirrorLive.parse(fixture('mirror.live')).seq).toBeGreaterThanOrEqual(0);
    const [project] = zMirrorProjects.parse(fixture('mirror.projects')).projects;
    expect(Object.keys(project ?? {}).sort()).toEqual(['displayName', 'githubRepoId', 'installationId', 'integrationBranch', 'projectId', 'repository'].sort());
    expect(zServerToRunner.parse(fixture('mirror.resync'))).toMatchObject({ type: 'mirror.resync' });
  });
});
