import { ARTIFACT_PLAINTEXT_MAX, type ArtifactTicket } from '@crewdeck/contracts';
import { server } from 'vitest/browser';
import { GithubReadError, createGithubFetcher } from './github-fetcher.js';
import { createLocalFetcher } from './local-fetcher.js';
import { ArtifactUnavailable, createDocumentReader, documentKey } from './reader.js';

const PROJECT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d21';
const API = 'https://api.github.com';
const REPO = `${API}/repos/acme/boutique`;

/** GitHub's answers as recorded, by URL; what the fetcher asked, with its headers. */
const fakeGithub = (routes: Record<string, () => Response>) => {
  const calls: { url: string; accept: string | null; authorization: string | null }[] = [];
  const fetch = (input: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers);
    calls.push({ url: input, accept: headers.get('accept'), authorization: headers.get('authorization') });
    const route = routes[`${headers.get('accept')} ${input}`] ?? routes[input];
    return Promise.resolve(route ? route() : new Response('{"message":"Not Found"}', { status: 404 }));
  };
  const fetcher = createGithubFetcher({
    token: { get: () => Promise.resolve('ghu_jeton') },
    repository: (projectId) => (projectId === PROJECT ? { owner: 'acme', name: 'boutique', integrationBranch: 'develop' } : null),
    fetch,
  });
  return { fetcher, calls };
};

const json = (body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
const text = (body: string, status = 200) => () => new Response(body, { status });

const user = (login: string) => ({ login, id: 1, type: 'User' });

describe('the GitHub fetcher', () => {
  it('maps a recorded issue, its comments, what blocks it and its parent to the very Ticket the Runner seals for a Local Projet', async () => {
    const vector = JSON.parse(await server.commands.readFile('../../packages/contracts/fixtures/crypto/artifact.json')) as { plaintext: ArtifactTicket };
    const { fetcher, calls } = fakeGithub({
      [`${REPO}/issues/12`]: json({
        number: 12,
        title: 'Le panier',
        body: 'Le panier garde MARQUEUR-7f3a9c.\n',
        state: 'open',
        state_reason: null,
        labels: [{ id: 1, name: 'front', color: 'fff' }, { id: 2, name: 'ready-for-agent', color: '000' }],
        milestone: null,
        user: user('pilote'),
      }),
      [`${REPO}/issues/12/comments?per_page=100`]: json([]),
      [`${REPO}/issues/12/dependencies/blocked_by?per_page=100`]: json([{ number: 3, title: 'Le catalogue', state: 'open' }]),
    });

    expect(await fetcher.fetch(PROJECT, 'ticket', { number: 12 })).toEqual(vector.plaintext);
    expect(calls.every((call) => call.authorization === 'Bearer ghu_jeton')).toBe(true);
    expect(calls.map((call) => call.url)).toContain(`${REPO}/issues/12/parent`);
  });

  it('maps a closed Ticket’s reason, its milestone, its parent and every page of its comments', async () => {
    const { fetcher } = fakeGithub({
      [`${REPO}/issues/7`]: json({
        number: 7,
        title: 'Livrer',
        body: null,
        state: 'closed',
        state_reason: 'not_planned',
        labels: ['bug'],
        milestone: { number: 2, title: 'S2', description: null, due_on: '2026-12-01T00:00:00Z' },
      }),
      [`${REPO}/issues/7/comments?per_page=100`]: json([{ user: user('ana'), body: 'Un', created_at: '2026-11-01T10:00:00Z' }], {
        link: `<${REPO}/issues/7/comments?per_page=100&page=2>; rel="next", <${REPO}/issues/7/comments?per_page=100&page=2>; rel="last"`,
      }),
      [`${REPO}/issues/7/comments?per_page=100&page=2`]: json([{ user: null, body: 'Deux', created_at: '2026-11-02T10:00:00Z' }]),
      [`${REPO}/issues/7/dependencies/blocked_by?per_page=100`]: json([]),
      [`${REPO}/issues/7/parent`]: json({ number: 1, title: 'Épopée' }),
    });

    expect(await fetcher.fetch(PROJECT, 'ticket', { number: 7 })).toEqual({
      number: 7,
      title: 'Livrer',
      body: '',
      state: 'CLOSED',
      stateReason: 'NOT_PLANNED',
      labels: [{ name: 'bug' }],
      milestone: { number: 2, title: 'S2', description: '', dueOn: '2026-12-01T00:00:00Z' },
      comments: [
        { author: { login: 'ana' }, body: 'Un', createdAt: '2026-11-01T10:00:00Z' },
        { author: null, body: 'Deux', createdAt: '2026-11-02T10:00:00Z' },
      ],
      blockedBy: [],
      parent: 1,
    });
  });

  it('answers not-found for a pull request read as a Ticket', async () => {
    const { fetcher } = fakeGithub({
      [`${REPO}/issues/9`]: json({ number: 9, title: 'PR', body: '', state: 'open', labels: [], milestone: null, pull_request: { url: 'x' } }),
    });
    await expect(fetcher.fetch(PROJECT, 'ticket', { number: 9 })).rejects.toEqual(new ArtifactUnavailable('not-found'));
  });

  it('maps a recorded pull request, its reviews and its comments to the change’s shape', async () => {
    const { fetcher } = fakeGithub({
      [`${REPO}/pulls/31`]: json({
        number: 31,
        title: 'Le panier',
        body: 'Closes #12',
        state: 'closed',
        merged_at: '2026-11-10T12:00:00Z',
        head: { ref: 'feat/12-panier', sha: 'a1b2c3' },
        base: { ref: 'develop', sha: 'd4e5f6' },
      }),
      [`${REPO}/pulls/31/reviews?per_page=100`]: json([
        { user: user('relecteur'), state: 'APPROVED', body: 'Bien', submitted_at: '2026-11-09T09:00:00Z', commit_id: 'a1b2c3' },
        { user: null, state: 'COMMENTED', body: null, submitted_at: null, commit_id: null },
      ]),
      [`${REPO}/issues/31/comments?per_page=100`]: json([{ user: user('pilote'), body: 'Merci', created_at: '2026-11-09T10:00:00Z' }]),
    });

    expect(await fetcher.fetch(PROJECT, 'change', { number: 31 })).toEqual({
      number: 31,
      title: 'Le panier',
      body: 'Closes #12',
      state: 'MERGED',
      headRefName: 'feat/12-panier',
      headRefOid: 'a1b2c3',
      baseRefName: 'develop',
      reviews: [
        { author: { login: 'relecteur' }, state: 'APPROVED', body: 'Bien', submittedAt: '2026-11-09T09:00:00Z', commit: { oid: 'a1b2c3' } },
        { author: null, state: 'COMMENTED', body: '', submittedAt: null, commit: null },
      ],
      comments: [{ author: { login: 'pilote' }, body: 'Merci', createdAt: '2026-11-09T10:00:00Z' }],
    });
  });

  it('reads a change’s diff, or a comparison of two branches, as GitHub’s unified diff', async () => {
    const patch = 'diff --git a/panier.ts b/panier.ts\n+export const panier = [];\n';
    const { fetcher, calls } = fakeGithub({
      [`application/vnd.github+json ${REPO}/pulls/31`]: json({ number: 31, state: 'open', head: { ref: 'feat/12-panier', sha: 'a1' }, base: { ref: 'develop' } }),
      [`application/vnd.github.diff ${REPO}/pulls/31`]: text(patch),
      [`application/vnd.github.diff ${REPO}/compare/develop...feat/12-panier`]: text(patch),
      [`application/vnd.github.diff ${REPO}/compare/develop...feat/enorme`]: text('{"message":"too large"}', 406),
    });

    expect(await fetcher.fetch(PROJECT, 'diff', { number: 31 })).toEqual({ base: 'develop', head: 'feat/12-panier', patch });
    expect(await fetcher.fetch(PROJECT, 'diff', { base: 'develop', head: 'feat/12-panier' })).toEqual({ base: 'develop', head: 'feat/12-panier', patch });
    expect(calls.filter((call) => call.accept === 'application/vnd.github.diff')).toHaveLength(2);
    await expect(fetcher.fetch(PROJECT, 'diff', { base: 'develop', head: 'feat/enorme' })).rejects.toEqual(new ArtifactUnavailable('too-large'));
  });

  it('reads a file at the integration branch, a branch or a SHA, its blob’s SHA, as text or base64 for bytes', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const { fetcher, calls } = fakeGithub({
      [`${REPO}/contents/docs/prd.md?ref=develop`]: json({ type: 'file', path: 'docs/prd.md', sha: 'blob1', size: 9, encoding: 'base64', content: 'IyBQUkQg\nw6k=\n' }),
      [`${REPO}/contents/docs/prd.md?ref=0123abcd`]: json({ type: 'file', path: 'docs/prd.md', sha: 'blob0', size: 5, encoding: 'base64', content: btoa('# v0\n') }),
      [`${REPO}/contents/logo.png?ref=feat%2Flogo`]: json({ type: 'file', path: 'logo.png', sha: 'blob2', size: 6, encoding: 'base64', content: btoa(String.fromCharCode(...bytes)) }),
    });

    expect(await fetcher.fetch(PROJECT, 'file', { path: 'docs/prd.md' })).toEqual({ path: 'docs/prd.md', sha: 'blob1', content: '# PRD é' });
    expect(await fetcher.fetch(PROJECT, 'file', { path: 'docs/prd.md', at: '0123abcd' })).toEqual({ path: 'docs/prd.md', sha: 'blob0', content: '# v0\n' });
    expect(await fetcher.fetch(PROJECT, 'file', { path: 'logo.png', at: 'feat/logo' })).toEqual({ path: 'logo.png', sha: 'blob2', content: btoa(String.fromCharCode(...bytes)), binary: true });
    expect(calls.every((call) => call.accept === 'application/vnd.github+json')).toBe(true);
  });

  it('reads a file past GitHub’s 1 MB as its raw bytes', async () => {
    const big = `${'a'.repeat(1_100_000)}\n`;
    const { fetcher } = fakeGithub({
      [`application/vnd.github+json ${REPO}/contents/gros.txt?ref=develop`]: json({ type: 'file', path: 'gros.txt', sha: 'blob3', size: big.length, encoding: 'none', content: '' }),
      [`application/vnd.github.raw+json ${REPO}/contents/gros.txt?ref=develop`]: text(big),
    });

    expect(await fetcher.fetch(PROJECT, 'file', { path: 'gros.txt' })).toEqual({ path: 'gros.txt', sha: 'blob3', content: big });
  });

  it('answers too-large for a 5 MiB file, not-found for a path outside the repository, a directory, a 404 or an unknown Projet', async () => {
    const { fetcher, calls } = fakeGithub({
      [`${REPO}/contents/video.mp4?ref=develop`]: json({ type: 'file', path: 'video.mp4', sha: 'blob4', size: 5 * 1024 * 1024, encoding: 'none', content: '' }),
      [`${REPO}/contents/docs?ref=develop`]: json([{ type: 'file', path: 'docs/prd.md', sha: 'blob1', size: 9 }]),
    });

    await expect(fetcher.fetch(PROJECT, 'file', { path: 'video.mp4' })).rejects.toEqual(new ArtifactUnavailable('too-large'));
    expect(calls).toHaveLength(1);
    await expect(fetcher.fetch(PROJECT, 'file', { path: 'docs' })).rejects.toEqual(new ArtifactUnavailable('not-found'));
    await expect(fetcher.fetch(PROJECT, 'file', { path: 'absent.md' })).rejects.toEqual(new ArtifactUnavailable('not-found'));
    await expect(fetcher.fetch(PROJECT, 'ticket', { number: 404 })).rejects.toEqual(new ArtifactUnavailable('not-found'));

    calls.length = 0;
    await expect(fetcher.fetch(PROJECT, 'file', { path: '../x' })).rejects.toEqual(new ArtifactUnavailable('not-found'));
    await expect(fetcher.fetch('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d99', 'ticket', { number: 12 })).rejects.toEqual(new ArtifactUnavailable('not-found'));
    await expect(fetcher.fetch(PROJECT, 'command-output', { runId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d22' })).rejects.toEqual(new ArtifactUnavailable('not-found'));
    expect(calls).toEqual([]);
  });

  it('answers too-large for more than the plaintext’s 4 MiB, as the Runner does', async () => {
    const { fetcher } = fakeGithub({ [`application/vnd.github.diff ${REPO}/compare/develop...feat/x`]: text('+'.repeat(ARTIFACT_PLAINTEXT_MAX)) });
    await expect(fetcher.fetch(PROJECT, 'diff', { base: 'develop', head: 'feat/x' })).rejects.toEqual(new ArtifactUnavailable('too-large'));
  });

  it('rejects with GitHub’s status what is a failure, not an artefact absent', async () => {
    const { fetcher } = fakeGithub({ [`${REPO}/issues/12`]: text('{"message":"rate limited"}', 403) });
    await expect(fetcher.fetch(PROJECT, 'ticket', { number: 12 })).rejects.toEqual(new GithubReadError(403));
  });

  it('shares the reader’s keys with the Local fetcher: a Ticket read from GitHub is the one a Local read finds fresh', async () => {
    const { fetcher } = fakeGithub({
      [`${REPO}/issues/12`]: json({ number: 12, title: 'Le panier', body: '', state: 'open', labels: [], milestone: null }),
      [`${REPO}/issues/12/comments?per_page=100`]: json([]),
    });
    const local = createLocalFetcher({
      socket: { sendArtifact: () => false, onArtifact: () => () => undefined },
      devices: { getDevice: () => Promise.resolve(null) },
    });
    const reader = createDocumentReader({ fetchers: { github: fetcher, local } });

    const fromGithub = await reader.read({ projectId: PROJECT, source: 'github', kind: 'ticket', ref: { number: 12 } });
    expect(fromGithub.state).toBe('ready');
    expect(await reader.read({ projectId: PROJECT, source: 'local', kind: 'ticket', ref: { number: 12 } })).toEqual(fromGithub);
    expect(reader.client.getQueryData(documentKey(PROJECT, 'ticket', { number: 12 }))).toEqual(fromGithub);
  });
});
