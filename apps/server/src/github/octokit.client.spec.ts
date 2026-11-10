import { zIssue, zPullRequest } from '@crewdeck/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { githubAppEnv } from '../../test/github-app.js';
import { AppError } from '../errors/app-error.js';
import { parseEnv } from '../config/env.js';
import { GitHubReadForbiddenError } from './read-guard.js';
import { OctokitGitHubClient } from './octokit.client.js';

/** Every request ends here, never at GitHub: an unhandled one fails the test. */
const API = 'https://api.github.com';
const WEB = 'https://github.com';
const server = setupServer();

const repo = { owner: 'o', name: 'r', id: 7 };
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', ...githubAppEnv() });

const logger = () => ({ error: vi.fn(), warn: vi.fn() });

/** The installation of `o/r` (42) and its token, which every call on the repository goes through. */
const installation = () => [
  http.get(`${API}/repos/o/r/installation`, () => HttpResponse.json({ id: 42 })),
  http.post(`${API}/app/installations/42/access_tokens`, () =>
    HttpResponse.json({ token: 'ghs_installation', expires_at: '2026-11-10T13:00:00Z', permissions: {}, repository_selection: 'all' }, { status: 201 }),
  ),
];

const issuePayload = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Ticket ${number}`,
  state: 'open',
  body: 'the body, never mapped',
  labels: [{ name: 'type: chore', color: 'ededed' }],
  milestone: { number: 1, title: 'M1 Socle', description: 'not mapped' },
  updated_at: '2026-11-10T12:00:00Z',
  ...extra,
});

const prPayload = {
  number: 3,
  title: 'feat(server) : client GitHub',
  state: 'open',
  draft: false,
  merged: false,
  body: 'the body, never mapped',
  head: { ref: 'feat/27-x', sha: SHA },
  base: { ref: 'develop', sha: OTHER_SHA },
  labels: [{ name: 'revue-visuelle' }],
  updated_at: '2026-11-10T12:00:00Z',
};

describe('OctokitGitHubClient', () => {
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  describe('installation tokens', () => {
    it('asks one with the App JWT, restricted to repositories and permissions', async () => {
      let sent: { authorization: string | null; body: unknown } | undefined;
      server.use(
        http.post(`${API}/app/installations/42/access_tokens`, async ({ request }) => {
          sent = { authorization: request.headers.get('authorization'), body: await request.json() };
          return HttpResponse.json({ token: 'ghs_session', expires_at: '2026-11-10T13:00:00Z', permissions: { contents: 'write' } }, { status: 201 });
        }),
      );
      const client = new OctokitGitHubClient(env, logger());

      const token = await client.installationToken(42, { repositoryIds: [7], permissions: { contents: 'write' } });

      expect(token).toEqual({ token: 'ghs_session', expiresAt: '2026-11-10T13:00:00Z' });
      expect(sent?.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      expect(sent?.body).toEqual({ repository_ids: [7], permissions: { contents: 'write' } });
    });

    it('lists the repositories of an installation, every page', async () => {
      const page = (ids: number[]) => ids.map((id) => ({ id, name: `r${id}`, owner: { login: 'o' } }));
      server.use(
        ...installation(),
        http.get(`${API}/installation/repositories`, ({ request }) => {
          const second = new URL(request.url).searchParams.get('page') === '2';
          return HttpResponse.json(
            { total_count: 3, repositories: second ? page([3]) : page([1, 2]) },
            second ? {} : { headers: { link: `<${API}/installation/repositories?per_page=100&page=2>; rel="next"` } },
          );
        }),
      );

      const repos = await new OctokitGitHubClient(env, logger()).listInstallationRepositories(42);

      expect(repos).toEqual([
        { owner: 'o', name: 'r1', id: 1 },
        { owner: 'o', name: 'r2', id: 2 },
        { owner: 'o', name: 'r3', id: 3 },
      ]);
    });
  });

  describe('labels', () => {
    it('lists them with the installation token of the repository', async () => {
      let authorization: string | null = null;
      server.use(
        ...installation(),
        http.get(`${API}/repos/o/r/labels`, ({ request }) => {
          authorization = request.headers.get('authorization');
          return HttpResponse.json([{ id: 1, name: 'needs-human', color: 'd73a4a', description: null, default: false }]);
        }),
      );

      const labels = await new OctokitGitHubClient(env, logger()).listLabels(repo);

      expect(labels).toEqual([{ name: 'needs-human', color: 'd73a4a', description: null }]);
      expect(authorization).toBe('token ghs_installation');
    });

    it('updates a label that already exists', async () => {
      const patched: unknown[] = [];
      server.use(
        ...installation(),
        http.post(`${API}/repos/o/r/labels`, () =>
          HttpResponse.json({ message: 'Validation Failed', errors: [{ resource: 'Label', code: 'already_exists', field: 'name' }] }, { status: 422 }),
        ),
        http.patch(`${API}/repos/o/r/labels/:name`, async ({ request, params }) => {
          patched.push({ name: params['name'], body: await request.json() });
          return HttpResponse.json({ name: 'needs-human', color: '000000', description: 'À trancher' });
        }),
      );

      const label = await new OctokitGitHubClient(env, logger()).ensureLabel(repo, { name: 'needs-human', color: '000000', description: 'À trancher' });

      expect(label).toEqual({ name: 'needs-human', color: '000000', description: 'À trancher' });
      expect(patched).toEqual([{ name: 'needs-human', body: { color: '000000', description: 'À trancher' } }]);
    });
  });

  describe('merges', () => {
    it('merges a PR with the SHA the gate judged', async () => {
      let body: unknown;
      server.use(
        ...installation(),
        http.put(`${API}/repos/o/r/pulls/3/merge`, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ sha: OTHER_SHA, merged: true, message: 'Pull Request successfully merged' });
        }),
      );

      const merge = await new OctokitGitHubClient(env, logger()).mergePullRequest(repo, 3, { sha: SHA, method: 'squash' });

      expect(merge).toEqual({ sha: OTHER_SHA });
      expect(body).toEqual({ sha: SHA, merge_method: 'squash' });
    });

    it('throws github.head-moved when the head moved, without retrying', async () => {
      let calls = 0;
      server.use(
        ...installation(),
        http.put(`${API}/repos/o/r/pulls/3/merge`, () => {
          calls += 1;
          return HttpResponse.json({ message: 'Head branch was modified. Review and try the merge again.' }, { status: 409 });
        }),
      );

      const merge = new OctokitGitHubClient(env, logger()).mergePullRequest(repo, 3, { sha: SHA, method: 'squash' });

      await expect(merge).rejects.toMatchObject({ status: 409, code: 'github.head-moved', message: 'La PR a changé depuis la dernière vérification.' });
      expect(calls).toBe(1);
    });

    it('merges a branch through the merges API', async () => {
      let body: unknown;
      server.use(
        ...installation(),
        http.post(`${API}/repos/o/r/merges`, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ sha: OTHER_SHA }, { status: 201 });
        }),
      );

      const merge = await new OctokitGitHubClient(env, logger()).mergeBranch(repo, { base: 'develop', headSha: SHA, message: 'chore(crewdeck) : Inventaire' });

      expect(merge).toEqual({ sha: OTHER_SHA });
      expect(body).toEqual({ base: 'develop', head: SHA, commit_message: 'chore(crewdeck) : Inventaire' });
    });

    it('throws github.branch-protected when a protection refuses the write', async () => {
      server.use(
        ...installation(),
        http.post(`${API}/repos/o/r/merges`, () =>
          HttpResponse.json({ message: 'Repository rule violations found\n\nChanges must be made through a pull request.' }, { status: 409 }),
        ),
      );

      const merge = new OctokitGitHubClient(env, logger()).mergeBranch(repo, { base: 'develop', headSha: SHA, message: 'chore(crewdeck) : x' });

      await expect(merge).rejects.toMatchObject({ status: 422, code: 'github.branch-protected', message: 'Une protection de branche refuse cette écriture.' });
    });
  });

  describe('any other failure', () => {
    it('is github.unavailable, logged with the GitHub request id only', async () => {
      server.use(
        ...installation(),
        http.get(`${API}/repos/o/r/labels`, () =>
          HttpResponse.json({ message: 'Resource not accessible by integration: secret detail' }, { status: 403, headers: { 'x-github-request-id': 'ABCD:1234' } }),
        ),
      );
      const log = logger();

      const labels = new OctokitGitHubClient(env, log).listLabels(repo);

      await expect(labels).rejects.toBeInstanceOf(AppError);
      await expect(labels).rejects.toMatchObject({ status: 500, code: 'github.unavailable', message: 'GitHub ne répond pas, réessaie dans un instant.' });
      expect(log.error).toHaveBeenCalledWith({ githubRequestId: 'ABCD:1234', status: 403 }, 'GitHub request failed');
      expect(JSON.stringify(log.error.mock.calls)).not.toContain('secret detail');
    });

    it('is github.unavailable when the App is not configured, before any request', async () => {
      const bare = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck' });

      await expect(new OctokitGitHubClient(bare, logger()).listLabels(repo)).rejects.toMatchObject({ code: 'github.unavailable' });
    });
  });

  describe('metadata', () => {
    it('maps issues without their body, leaves the PRs out, and gives the next page', async () => {
      let query: URLSearchParams | undefined;
      server.use(
        ...installation(),
        http.get(`${API}/repos/o/r/issues`, ({ request }) => {
          query = new URL(request.url).searchParams;
          return HttpResponse.json([issuePayload(5), issuePayload(6, { pull_request: { url: 'x' } })], {
            headers: { link: `<${API}/repositories/7/issues?state=all&page=3>; rel="next", <${API}/repositories/7/issues?page=9>; rel="last"` },
          });
        }),
      );

      const page = await new OctokitGitHubClient(env, logger()).listIssues(repo, { state: 'all', since: '2026-11-01T00:00:00Z', cursor: '2' });

      expect(page).toEqual({
        items: [{ number: 5, title: 'Ticket 5', state: 'open', labels: ['type: chore'], milestone: { number: 1, title: 'M1 Socle' }, updatedAt: '2026-11-10T12:00:00Z' }],
        nextCursor: '3',
      });
      expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(Object.keys(zIssue.shape).sort());
      expect(Object.fromEntries(query ?? [])).toMatchObject({ state: 'all', since: '2026-11-01T00:00:00Z', page: '2' });
    });

    it('maps a PR without its body', async () => {
      server.use(...installation(), http.get(`${API}/repos/o/r/pulls/3`, () => HttpResponse.json(prPayload)));

      const pr = await new OctokitGitHubClient(env, logger()).getPullRequest(repo, 3);

      expect(pr).toEqual({
        number: 3,
        title: 'feat(server) : client GitHub',
        state: 'open',
        draft: false,
        merged: false,
        headRef: 'feat/27-x',
        headSha: SHA,
        baseRef: 'develop',
        labels: ['revue-visuelle'],
        updatedAt: '2026-11-10T12:00:00Z',
      });
      expect(Object.keys(pr ?? {}).sort()).toEqual(Object.keys(zPullRequest.shape).sort());
    });

    it('maps sub-issues and blocked-by dependencies without their body', async () => {
      server.use(
        ...installation(),
        http.get(`${API}/repos/o/r/issues/3/sub_issues`, () => HttpResponse.json([issuePayload(4)])),
        http.get(`${API}/repos/o/r/issues/3/dependencies/blocked_by`, () =>
          HttpResponse.json([issuePayload(9, { state: 'closed', repository_url: `${API}/repos/other/lib` })]),
        ),
      );
      const client = new OctokitGitHubClient(env, logger());

      expect(await client.listSubIssues(repo, 3)).toEqual([expect.not.objectContaining({ body: expect.anything() })]);
      expect(await client.listIssueDependencies(repo, 3)).toEqual([{ owner: 'other', name: 'lib', number: 9, state: 'closed' }]);
    });

    it('gives null for a branch that does not exist', async () => {
      server.use(...installation(), http.get(`${API}/repos/o/r/branches/:name`, () => HttpResponse.json({ message: 'Branch not found' }, { status: 404 })));

      expect(await new OctokitGitHubClient(env, logger()).getBranch(repo, 'nope')).toBeNull();
    });

    it('maps the checks and the statuses of a SHA', async () => {
      server.use(
        ...installation(),
        http.get(`${API}/repos/o/r/commits/${SHA}/check-runs`, () =>
          HttpResponse.json({ total_count: 1, check_runs: [{ id: 11, name: 'ci', status: 'completed', conclusion: 'success', output: { summary: 'x' } }] }),
        ),
        http.get(`${API}/repos/o/r/commits/${SHA}/status`, () =>
          HttpResponse.json({ state: 'pending', statuses: [{ context: 'deploy', state: 'pending', description: 'x' }] }),
        ),
      );
      const client = new OctokitGitHubClient(env, logger());

      expect(await client.listCheckRuns(repo, SHA)).toEqual([{ id: 11, name: 'ci', status: 'completed', conclusion: 'success' }]);
      expect(await client.getCombinedStatus(repo, SHA)).toEqual({ state: 'pending', statuses: [{ context: 'deploy', state: 'pending' }] });
    });
  });

  describe('the allowlist of contents', () => {
    it('reads .process.json at a ref, and null when it does not exist', async () => {
      server.use(
        ...installation(),
        http.get(`${API}/repos/o/r/contents/.process.json`, ({ request }) =>
          new URL(request.url).searchParams.get('ref') === 'main'
            ? HttpResponse.json({ type: 'file', encoding: 'base64', content: Buffer.from('{"version":1}').toString('base64') })
            : HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
        ),
      );
      const client = new OctokitGitHubClient(env, logger());

      expect(await client.readProcessJson(repo, 'main')).toEqual({ version: 1 });
      expect(await client.readProcessJson(repo, 'other')).toBeNull();
    });

    it('tells whether docs/adr exists', async () => {
      server.use(
        ...installation(),
        http.get(`${API}/repos/o/r/contents/docs%2Fadr`, () => HttpResponse.json([{ type: 'file', name: '0001.md' }])),
        http.get(`${API}/repos/o/r/contents/CONTEXT.md`, () => HttpResponse.json({ message: 'Not Found' }, { status: 404 })),
      );
      const client = new OctokitGitHubClient(env, logger());

      expect(await client.pathExists(repo, 'main', 'docs/adr')).toBe(true);
      expect(await client.pathExists(repo, 'main', 'CONTEXT.md')).toBe(false);
    });

    it('commits .process.json over its current version', async () => {
      let body: unknown;
      server.use(
        ...installation(),
        http.get(`${API}/repos/o/r/contents/.process.json`, () => HttpResponse.json({ type: 'file', sha: 'c'.repeat(40), content: '' })),
        http.put(`${API}/repos/o/r/contents/.process.json`, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ commit: { sha: OTHER_SHA } });
        }),
      );

      const commit = await new OctokitGitHubClient(env, logger()).commitProcessJson(repo, 'develop', '{"version":1}\n', 'chore(crewdeck) : Process');

      expect(commit).toEqual({ sha: OTHER_SHA });
      expect(body).toEqual({ message: 'chore(crewdeck) : Process', content: Buffer.from('{"version":1}\n').toString('base64'), branch: 'develop', sha: 'c'.repeat(40) });
    });

    it('never lets the read guard fall into github.unavailable', async () => {
      server.use(...installation());
      const client = new OctokitGitHubClient(env, logger());

      // Through a cast: the interface has no such path, which is the first fence.
      await expect(client.pathExists(repo, 'main', 'src/main.ts' as 'CONTEXT.md')).rejects.toBeInstanceOf(GitHubReadForbiddenError);
    });
  });

  describe('the user authorization', () => {
    it('builds the authorize URL on GitHub', () => {
      const url = new URL(new OctokitGitHubClient(env, logger()).authorizeUrl('st4te', 'https://crewdeck.example/api/auth/callback'));

      expect(`${url.origin}${url.pathname}`).toBe(`${WEB}/login/oauth/authorize`);
      expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'Iv23-test-client', redirect_uri: 'https://crewdeck.example/api/auth/callback', state: 'st4te' });
    });

    it('exchanges a code for the user tokens', async () => {
      let body: unknown;
      server.use(
        http.post(`${WEB}/login/oauth/access_token`, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ access_token: 'ghu_a', expires_in: 28800, refresh_token: 'ghr_b', refresh_token_expires_in: 15897600, token_type: 'bearer' });
        }),
      );
      const before = Date.now();

      const tokens = await new OctokitGitHubClient(env, logger()).exchangeCode('c0de', 'https://crewdeck.example/api/auth/callback');

      const after = Date.now();
      const expiresIn = (instant: string, seconds: number) => {
        const at = Date.parse(instant) - seconds * 1000;
        return at >= before && at <= after;
      };
      expect(tokens).toMatchObject({ accessToken: 'ghu_a', refreshToken: 'ghr_b' });
      expect(expiresIn(tokens.accessTokenExpiresAt, 28800)).toBe(true);
      expect(expiresIn(tokens.refreshTokenExpiresAt, 15897600)).toBe(true);
      expect(body).toEqual({ client_id: 'Iv23-test-client', client_secret: 'test-client-secret', code: 'c0de', redirect_uri: 'https://crewdeck.example/api/auth/callback' });
    });

    it('throws github.unavailable for a code GitHub refuses', async () => {
      server.use(http.post(`${WEB}/login/oauth/access_token`, () => HttpResponse.json({ error: 'bad_verification_code', error_description: 'x' })));

      await expect(new OctokitGitHubClient(env, logger()).exchangeCode('stale', 'https://x.example/cb')).rejects.toMatchObject({ code: 'github.unavailable' });
    });

    it('reads the user a token belongs to', async () => {
      let authorization: string | null = null;
      server.use(
        http.get(`${API}/user`, ({ request }) => {
          authorization = request.headers.get('authorization');
          return HttpResponse.json({ id: 1, login: 'pilote', avatar_url: 'https://avatars.example/u/1', email: 'not mapped' });
        }),
      );

      expect(await new OctokitGitHubClient(env, logger()).getAuthenticatedUser('ghu_a')).toEqual({ id: 1, login: 'pilote', avatarUrl: 'https://avatars.example/u/1' });
      expect(authorization).toBe('token ghu_a');
    });
  });
});
