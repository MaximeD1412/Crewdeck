import { AppError } from '../errors/app-error.js';
import type { RepoRef } from '@crewdeck/contracts';
import { FakeGitHub } from './fake-github.js';

const setup = () => {
  const github = new FakeGitHub();
  const repo = github.seedRepo({ owner: 'o', name: 'r', files: { '.process.json': '{"version":1}', 'docs/adr/0001-shape.md': '# Shape', 'src/main.ts': 'code' } });
  return { github, repo };
};

describe('FakeGitHub', () => {
  describe('merges bound to a SHA', () => {
    it('merges a PR at the SHA of its head', async () => {
      const { github, repo } = setup();
      const head = await github.pushCommit(repo, 'feat/1-x', { 'src/a.ts': 'a' });
      const pr = await github.createPullRequest(repo, { head: 'feat/1-x', base: 'main', title: 'feat : x', draft: false });

      const merge = await github.mergePullRequest(repo, pr.number, { sha: head, method: 'squash' });

      expect(await github.getPullRequest(repo, pr.number)).toMatchObject({ state: 'closed', merged: true });
      expect((await github.getBranch(repo, 'main'))?.sha).toBe(merge.sha);
      expect(github.fileAt(repo.owner, repo.name, merge.sha, 'src/a.ts')).toBe('a');
    });

    it('throws github.head-moved with a stale SHA, and merges nothing', async () => {
      const { github, repo } = setup();
      const judged = await github.pushCommit(repo, 'feat/1-x', { 'src/a.ts': 'a' });
      const pr = await github.createPullRequest(repo, { head: 'feat/1-x', base: 'main', title: 'feat : x', draft: false });
      const moved = await github.pushCommit(repo, 'feat/1-x', { 'src/a.ts': 'b' });

      const merge = github.mergePullRequest(repo, pr.number, { sha: judged, method: 'squash' });

      await expect(merge).rejects.toBeInstanceOf(AppError);
      await expect(merge).rejects.toMatchObject({ status: 409, code: 'github.head-moved', message: 'La PR a changé depuis la dernière vérification.' });
      expect(await github.getPullRequest(repo, pr.number)).toMatchObject({ state: 'open', merged: false, headSha: moved });
    });

    it('throws github.head-moved when .process.json was committed on the head since', async () => {
      const { github, repo } = setup();
      const judged = await github.pushCommit(repo, 'feat/1-x', { 'src/a.ts': 'a' });
      const pr = await github.createPullRequest(repo, { head: 'feat/1-x', base: 'main', title: 'feat : x', draft: false });
      const moved = await github.commitProcessJson(repo, 'feat/1-x', '{"version":2}', 'chore(crewdeck) : Process');

      await expect(github.mergePullRequest(repo, pr.number, { sha: judged, method: 'squash' })).rejects.toMatchObject({ code: 'github.head-moved' });
      expect(await github.getPullRequest(repo, pr.number)).toMatchObject({ state: 'open', headSha: moved.sha });
      expect(await github.readProcessJson(repo, 'main')).toEqual({ version: 1 });
    });

    it('moves the head of a PR whose branch a merge writes', async () => {
      const { github, repo } = setup();
      await github.pushCommit(repo, 'develop', {});
      const release = await github.createPullRequest(repo, { head: 'develop', base: 'main', title: 'release', draft: false });
      const feature = await github.pushCommit(repo, 'feat/1-x', { 'src/a.ts': 'a' });

      const merge = await github.mergeBranch(repo, { base: 'develop', headSha: feature, message: 'feat : x' });

      expect(await github.getPullRequest(repo, release.number)).toMatchObject({ headSha: merge.sha });
    });

    const merges = [
      [
        'a PR',
        async (github: FakeGitHub, repo: RepoRef, head: string) => {
          const pr = await github.createPullRequest(repo, { head: 'feat/1-x', base: 'main', title: 'feat : x', draft: false });
          return github.mergePullRequest(repo, pr.number, { sha: head, method: 'merge' });
        },
      ],
      ['a branch', (github: FakeGitHub, repo: RepoRef, head: string) => github.mergeBranch(repo, { base: 'main', headSha: head, message: 'feat : x' })],
    ] as const;

    it.each(merges)('merging %s keeps what the base changed and the head did not', async (_, merge) => {
      const { github, repo } = setup();
      const head = await github.pushCommit(repo, 'feat/1-x', { 'src/b.ts': 'b' });
      await github.pushCommit(repo, 'main', { 'src/main.ts': 'code changed on main' });

      const merged = await merge(github, repo, head);

      expect(github.fileAt(repo.owner, repo.name, merged.sha, 'src/main.ts')).toBe('code changed on main');
      expect(github.fileAt(repo.owner, repo.name, merged.sha, 'src/b.ts')).toBe('b');
    });

    it.each(merges)('merging %s takes what the head changed and the base did not', async (_, merge) => {
      const { github, repo } = setup();
      const head = await github.pushCommit(repo, 'feat/1-x', { 'src/main.ts': 'code changed on the head' });
      await github.pushCommit(repo, 'main', { 'README.md': '# r' });

      const merged = await merge(github, repo, head);

      expect(github.fileAt(repo.owner, repo.name, merged.sha, 'src/main.ts')).toBe('code changed on the head');
      expect(github.fileAt(repo.owner, repo.name, merged.sha, 'README.md')).toBe('# r');
    });

    it.each(merges)('merging %s refuses a conflict, and writes nothing', async (_, merge) => {
      const { github, repo } = setup();
      const head = await github.pushCommit(repo, 'feat/1-x', { 'src/main.ts': 'theirs' });
      const base = await github.pushCommit(repo, 'main', { 'src/main.ts': 'ours' });

      await expect(merge(github, repo, head)).rejects.toMatchObject({ code: 'github.unavailable' });
      expect((await github.getBranch(repo, 'main'))?.sha).toBe(base);
    });

    it('merges a branch already in the base without a commit', async () => {
      const { github, repo } = setup();
      const head = await github.pushCommit(repo, 'feat/1-x', { 'src/b.ts': 'b' });
      await github.mergeBranch(repo, { base: 'main', headSha: head, message: 'feat : x' });
      const base = (await github.getBranch(repo, 'main'))?.sha;

      expect(await github.mergeBranch(repo, { base: 'main', headSha: head, message: 'again' })).toEqual({ sha: base });
    });

    it('merges a branch through the merges API, refused on a protected base', async () => {
      const { github, repo } = setup();
      const head = await github.pushCommit(repo, 'crewdeck/inventaire', { 'CONTEXT.md': '# Glossaire' });

      const merge = await github.mergeBranch(repo, { base: 'main', headSha: head, message: 'chore(crewdeck) : Inventaire' });
      github.protectBranch(repo, 'main');

      expect(await github.pathExists(repo, merge.sha, 'CONTEXT.md')).toBe(true);
      await expect(github.mergeBranch(repo, { base: 'main', headSha: head, message: 'x' })).rejects.toMatchObject({ status: 422, code: 'github.branch-protected' });
    });
  });

  describe('.process.json, the only file the server writes', () => {
    it('commits it on a branch', async () => {
      const { github, repo } = setup();

      const commit = await github.commitProcessJson(repo, 'main', '{"version":2}', 'chore(crewdeck) : Process');

      expect(await github.readProcessJson(repo, 'main')).toEqual({ version: 2 });
      expect(await github.readProcessJson(repo, commit.sha)).toEqual({ version: 2 });
    });

    it('throws github.branch-protected on a protected branch, and writes nothing', async () => {
      const { github, repo } = setup();
      github.protectBranch(repo, 'main');

      const commit = github.commitProcessJson(repo, 'main', '{"version":2}', 'chore(crewdeck) : Process');

      await expect(commit).rejects.toMatchObject({ status: 422, code: 'github.branch-protected', message: 'Une protection de branche refuse cette écriture.' });
      expect(await github.readProcessJson(repo, 'main')).toEqual({ version: 1 });
      expect(await github.getBranch(repo, 'main')).toMatchObject({ protected: true });
    });

    it('reads null where it does not exist, and refuses invalid JSON', async () => {
      const github = new FakeGitHub();
      const repo = github.seedRepo({ owner: 'o', name: 'r' });
      expect(await github.readProcessJson(repo, 'main')).toBeNull();

      await github.pushCommit(repo, 'main', { '.process.json': '{ nope' });

      await expect(github.readProcessJson(repo, 'main')).rejects.toMatchObject({ status: 422, code: 'github.process-json-invalid' });
    });

    it('tells whether CONTEXT.md and docs/adr exist', async () => {
      const { github, repo } = setup();

      expect(await github.pathExists(repo, 'main', 'docs/adr')).toBe(true);
      expect(await github.pathExists(repo, 'main', 'CONTEXT.md')).toBe(false);
    });
  });

  describe('metadata', () => {
    it('lists issues by state and update, without their body, with their sub-issues and dependencies', async () => {
      const { github, repo } = setup();
      github.seedIssue(repo, { number: 1, title: 'Epic', body: 'secret', updatedAt: '2026-11-01T00:00:00Z', subIssues: [2] });
      github.seedIssue(repo, { number: 2, title: 'Ticket', labels: ['ready-for-agent'], milestone: { number: 1, title: 'M1' }, updatedAt: '2026-11-05T00:00:00Z' });
      github.seedIssue(repo, { number: 3, title: 'Done', state: 'closed', updatedAt: '2026-11-06T00:00:00Z', blockedBy: [{ owner: 'o', name: 'lib', number: 9, state: 'open' }] });

      const open = await github.listIssues(repo, { state: 'open' });
      const since = await github.listIssues(repo, { state: 'all', since: '2026-11-02T00:00:00Z' });

      expect(open).toEqual({
        items: [
          { number: 2, title: 'Ticket', state: 'open', labels: ['ready-for-agent'], milestone: { number: 1, title: 'M1' }, updatedAt: '2026-11-05T00:00:00Z' },
          { number: 1, title: 'Epic', state: 'open', labels: [], milestone: null, updatedAt: '2026-11-01T00:00:00Z' },
        ],
        nextCursor: null,
      });
      expect(since.items.map((issue) => issue.number)).toEqual([3, 2]);
      expect((await github.listSubIssues(repo, 1)).map((issue) => issue.number)).toEqual([2]);
      expect(await github.listIssueDependencies(repo, 3)).toEqual([{ owner: 'o', name: 'lib', number: 9, state: 'open' }]);
    });

    it('labels an issue, and removes a label it does not have in silence', async () => {
      const { github, repo } = setup();
      github.seedIssue(repo, { number: 1, title: 'Ticket' });
      await github.ensureLabel(repo, { name: 'needs-human', color: 'd73a4a', description: 'À trancher' });

      await github.addLabels(repo, 1, ['needs-human']);
      await github.removeLabel(repo, 1, 'absent');

      expect((await github.listIssues(repo, { state: 'open' })).items[0]?.labels).toEqual(['needs-human']);
      expect(await github.listLabels(repo)).toEqual([{ name: 'needs-human', color: 'd73a4a', description: 'À trancher' }]);
    });

    it('gives the checks and statuses seeded on a SHA', async () => {
      const { github, repo } = setup();
      const sha = (await github.getBranch(repo, 'main'))?.sha ?? '';
      github.setCheckRuns(repo, sha, [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]);

      expect(await github.listCheckRuns(repo, sha)).toEqual([{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]);
      expect(await github.getCombinedStatus(repo, sha)).toEqual({ state: 'pending', statuses: [] });
    });

    it('lists the repositories of an installation and gives tokens for it only', async () => {
      const github = new FakeGitHub();
      const repo = github.seedRepo({ owner: 'o', name: 'r', installationId: 5 });

      expect(await github.listInstallationRepositories(5)).toEqual([repo]);
      expect(await github.installationToken(5, { repositoryIds: [repo.id] })).toMatchObject({ token: expect.stringMatching(/^ghs_fake/) });
      await expect(github.installationToken(6)).rejects.toMatchObject({ code: 'github.unavailable' });
    });
  });

  describe('the user authorization', () => {
    it('gives the tokens of the seeded user for fake-code, and the user for its token', async () => {
      const github = new FakeGitHub();
      github.seedUser({ id: 1, login: 'pilote', avatarUrl: 'https://avatars.example/u/1' });

      const tokens = await github.exchangeCode('fake-code', 'http://localhost:4200/api/auth/callback');
      const refreshed = await github.refreshUserToken(tokens.refreshToken);

      expect(await github.getAuthenticatedUser(refreshed.accessToken)).toEqual({ id: 1, login: 'pilote', avatarUrl: 'https://avatars.example/u/1' });
      await expect(github.exchangeCode('other', 'x')).rejects.toMatchObject({ code: 'github.unavailable' });
      expect(github.authorizeUrl('st4te', 'http://localhost:4200/cb')).toBe('/fake-github/login/oauth/authorize?client_id=fake&redirect_uri=http%3A%2F%2Flocalhost%3A4200%2Fcb&state=st4te');
    });
  });

  describe('calls and reset', () => {
    it('records every call of the interface with its arguments', async () => {
      const { github, repo } = setup();

      await github.listLabels(repo);
      await github.addLabels(repo, 1, ['x']).catch(() => undefined);

      expect(github.calls).toEqual([
        { method: 'listLabels', args: [repo] },
        { method: 'addLabels', args: [repo, 1, ['x']] },
      ]);
    });

    it('forgets everything', async () => {
      const { github, repo } = setup();

      github.reset();

      expect(github.calls).toEqual([]);
      await expect(github.listLabels(repo)).rejects.toMatchObject({ code: 'github.unavailable' });
    });
  });
});

describe('the FakeGitHub of the unit tests (test/fakes/github.ts)', () => {
  it('asserts a call and its arguments', async () => {
    const { FakeGitHub: TestFakeGitHub } = await import('../../test/fakes/github.js');
    const github = new TestFakeGitHub();
    const repo = github.seedRepo({ owner: 'o', name: 'r' });

    await github.ensureLabel(repo, { name: 'needs-human', color: 'd73a4a', description: 'À trancher' });

    github.expectCalled('ensureLabel', [repo, { name: 'needs-human', color: 'd73a4a', description: 'À trancher' }]);
    github.expectNotCalled('mergePullRequest');
    expect(() => github.expectCalled('listLabels', [repo])).toThrow();
  });
});
