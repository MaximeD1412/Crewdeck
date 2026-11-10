import { createHash } from 'node:crypto';
import type {
  Branch,
  BranchMerge,
  CheckRun,
  CombinedStatus,
  CommitRef,
  GitHubUser,
  InstallationToken,
  InstallationTokenOptions,
  Issue,
  IssuePage,
  IssueQuery,
  IssueRef,
  IssueState,
  Label,
  LabelInput,
  MergeOptions,
  Milestone,
  NewPullRequest,
  PullRequest,
  RepoRef,
  UserTokens,
} from '@crewdeck/contracts';
import type { GitHubClient } from '../github/github.client.js';
import { branchProtected, githubUnavailable, headMoved, processJsonInvalid } from '../github/github.errors.js';
import type { Fake } from './fakes.js';

/** A file's content: text, or the bytes of an image (the captures). */
export type FileContent = string | Uint8Array;
type Files = ReadonlyMap<string, FileContent>;

interface FakeCommit {
  files: Files;
  parents: readonly string[];
}

export interface FakeCall {
  readonly method: keyof GitHubClient;
  readonly args: readonly unknown[];
}

interface FakeIssue extends Issue {
  body: string;
  subIssues: number[];
  blockedBy: IssueRef[];
}

/** A changed file of a PR, as the page reads it from `/pulls/:n/files`. */
export interface FakePullRequestFile {
  readonly filename: string;
  readonly status: 'added' | 'modified' | 'removed';
  readonly patch?: string;
}

interface FakePullRequest extends PullRequest {
  body: string;
  files: FakePullRequestFile[];
}

interface FakeRepo {
  readonly ref: RepoRef;
  readonly installationId: number | undefined;
  readonly defaultBranch: string;
  readonly branches: Map<string, { sha: string; protected: boolean }>;
  readonly labels: Map<string, Label>;
  readonly issues: Map<number, FakeIssue>;
  readonly pullRequests: Map<number, FakePullRequest>;
  readonly checkRuns: Map<string, CheckRun[]>;
  readonly statuses: Map<string, CombinedStatus>;
  readonly comments: { number: number; body: string }[];
  nextNumber: number;
}

export interface SeedRepo {
  readonly owner: string;
  readonly name: string;
  readonly id?: number;
  readonly installationId?: number;
  readonly defaultBranch?: string;
  /** The files of the first commit of the default branch. */
  readonly files?: Record<string, FileContent>;
}

export interface SeedIssue {
  readonly number?: number;
  readonly title: string;
  readonly state?: IssueState;
  readonly labels?: string[];
  readonly milestone?: Milestone | null;
  readonly body?: string;
  readonly updatedAt?: string;
  readonly subIssues?: number[];
  readonly blockedBy?: IssueRef[];
}

const HOUR = 3_600_000;
/** The instant of what is seeded without one, so that the captures stay the same from one run to the next. */
const SEEDED_AT = '2026-11-01T09:00:00.000Z';

/**
 * GitHub in memory, for `pnpm dev`, the end-to-end tests and the unit tests
 * of what uses `GitHubClient`: the same contract and the same errors as the
 * real client (`github.head-moved` on a stale SHA, `github.branch-protected`
 * on a protected branch, `github.unavailable` for what does not exist). The
 * scenarios seed it (`seedRepo`, `seedIssue`, `pushCommit`…); the page reads
 * what it serves under `/fake-github` (`fileAt`, `pullRequestPage`…).
 * Everything is deterministic: SHAs come from a counter.
 */
export class FakeGitHub implements GitHubClient, Fake {
  /** Every call of the `GitHubClient` interface, in order. */
  readonly calls: FakeCall[] = [];

  private repos = new Map<string, FakeRepo>();
  private commits = new Map<string, FakeCommit>();
  private users = new Map<number, GitHubUser>();
  private codes = new Map<string, number>();
  private accessTokens = new Map<string, number>();
  private refreshTokens = new Map<string, number>();
  private installations = new Set<number>();
  private counter = 0;

  reset(): void {
    this.calls.length = 0;
    this.repos = new Map();
    this.commits = new Map();
    this.users = new Map();
    this.codes = new Map();
    this.accessTokens = new Map();
    this.refreshTokens = new Map();
    this.installations = new Set();
    this.counter = 0;
  }

  // --- Seeding

  /** A GitHub user, who signs in with `code` (`fake-code`, what the fake authorize page gives). */
  seedUser(user: GitHubUser, { code = 'fake-code' }: { code?: string } = {}): GitHubUser {
    this.users.set(user.id, user);
    this.codes.set(code, user.id);
    return user;
  }

  seedInstallation(installationId: number): void {
    this.installations.add(installationId);
  }

  /** A repository with one commit on its default branch (`main`). */
  seedRepo(seed: SeedRepo): RepoRef {
    const ref: RepoRef = { owner: seed.owner, name: seed.name, id: seed.id ?? 1000 + this.repos.size + 1 };
    const defaultBranch = seed.defaultBranch ?? 'main';
    if (seed.installationId !== undefined) this.installations.add(seed.installationId);
    this.repos.set(this.key(ref), {
      ref,
      installationId: seed.installationId,
      defaultBranch,
      branches: new Map([[defaultBranch, { sha: this.commit(new Map(Object.entries(seed.files ?? {}))), protected: false }]]),
      labels: new Map(),
      issues: new Map(),
      pullRequests: new Map(),
      checkRuns: new Map(),
      statuses: new Map(),
      comments: [],
      nextNumber: 1,
    });
    return ref;
  }

  seedIssue(repo: RepoRef, seed: SeedIssue): Issue {
    const fake = this.repo(repo);
    const number = seed.number ?? fake.nextNumber;
    fake.nextNumber = Math.max(fake.nextNumber, number + 1);
    const issue: FakeIssue = {
      number,
      title: seed.title,
      state: seed.state ?? 'open',
      labels: [...(seed.labels ?? [])],
      milestone: seed.milestone ?? null,
      updatedAt: seed.updatedAt ?? SEEDED_AT,
      body: seed.body ?? '',
      subIssues: [...(seed.subIssues ?? [])],
      blockedBy: [...(seed.blockedBy ?? [])],
    };
    fake.issues.set(number, issue);
    return toIssue(issue);
  }

  /**
   * One commit on `branch` (created from the default branch if it does not
   * exist) with `files` over its current ones; the open PRs of that head move
   * with it. Its SHA, to test `github.head-moved`.
   */
  async pushCommit(repo: RepoRef, branch: string, files: Record<string, FileContent> = {}): Promise<string> {
    const fake = this.repo(repo);
    if (!fake.branches.has(branch)) fake.branches.set(branch, { sha: this.head(fake, fake.defaultBranch), protected: false });
    const parent = this.head(fake, branch);
    const sha = this.commit(new Map([...this.files(parent), ...Object.entries(files)]), [parent]);
    this.moveBranch(fake, branch, sha);
    return Promise.resolve(sha);
  }

  protectBranch(repo: RepoRef, name: string): void {
    const branch = this.repo(repo).branches.get(name);
    if (branch === undefined) throw new Error(`No branch ${name} in ${this.key(repo)}`);
    branch.protected = true;
  }

  /** The changed files and the body the page shows for a PR. */
  describePullRequest(repo: RepoRef, number: number, { body, files }: { body?: string; files?: FakePullRequestFile[] }): void {
    const pr = this.repo(repo).pullRequests.get(number);
    if (pr === undefined) throw new Error(`No PR #${number} in ${this.key(repo)}`);
    if (body !== undefined) pr.body = body;
    if (files !== undefined) pr.files = [...files];
  }

  setCheckRuns(repo: RepoRef, sha: string, runs: CheckRun[]): void {
    this.repo(repo).checkRuns.set(sha, [...runs]);
  }

  setCombinedStatus(repo: RepoRef, sha: string, status: CombinedStatus): void {
    this.repo(repo).statuses.set(sha, status);
  }

  /** The comments the server wrote on an issue or a PR. */
  commentsOn(repo: RepoRef, number: number): string[] {
    return this.repo(repo).comments.filter((comment) => comment.number === number).map((comment) => comment.body);
  }

  // --- What the page reads (`/fake-github`), never through `GitHubClient`

  /** A file at a ref (a branch or a SHA; the default branch when undefined), or undefined. */
  fileAt(owner: string, name: string, ref: string | undefined, path: string): FileContent | undefined {
    const sha = this.pageRef(owner, name, ref);
    return sha === undefined ? undefined : this.files(sha).get(path);
  }

  /** The names of the files and directories directly under `path`, or undefined when it is no directory. */
  directoryAt(owner: string, name: string, ref: string | undefined, path: string): { name: string; path: string; type: 'file' | 'dir' }[] | undefined {
    const sha = this.pageRef(owner, name, ref);
    if (sha === undefined) return undefined;
    const prefix = path === '' ? '' : `${path}/`;
    const entries = new Map<string, 'file' | 'dir'>();
    for (const file of this.files(sha).keys()) {
      if (!file.startsWith(prefix)) continue;
      const [first, ...rest] = file.slice(prefix.length).split('/');
      if (first !== undefined) entries.set(first, rest.length > 0 ? 'dir' : 'file');
    }
    if (entries.size === 0) return undefined;
    return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([entry, type]) => ({ name: entry, path: `${prefix}${entry}`, type }));
  }

  /** A PR with its body and its files, as the page reads it. */
  pullRequestPage(owner: string, name: string, number: number): (PullRequest & { body: string; files: FakePullRequestFile[] }) | undefined {
    const pr = this.repos.get(`${owner}/${name}`)?.pullRequests.get(number);
    return pr && { ...toPullRequest(pr), body: pr.body, files: [...pr.files] };
  }

  // --- GitHubClient: the user authorization

  authorizeUrl(state: string, redirectUri: string): string {
    this.record('authorizeUrl', state, redirectUri);
    return `/fake-github/login/oauth/authorize?${new URLSearchParams({ client_id: 'fake', redirect_uri: redirectUri, state }).toString()}`;
  }

  exchangeCode(code: string, redirectUri: string): Promise<UserTokens> {
    this.record('exchangeCode', code, redirectUri);
    return this.run(() => this.tokensFor(this.codes.get(code)));
  }

  refreshUserToken(refreshToken: string): Promise<UserTokens> {
    this.record('refreshUserToken', refreshToken);
    return this.run(() => {
      const userId = this.refreshTokens.get(refreshToken);
      this.refreshTokens.delete(refreshToken);
      return this.tokensFor(userId);
    });
  }

  getAuthenticatedUser(accessToken: string): Promise<GitHubUser> {
    this.record('getAuthenticatedUser', accessToken);
    return this.run(() => {
      const user = this.users.get(this.accessTokens.get(accessToken) ?? 0);
      if (user === undefined) throw githubUnavailable();
      return user;
    });
  }

  // --- GitHubClient: installations

  installationToken(installationId: number, options: InstallationTokenOptions = {}): Promise<InstallationToken> {
    this.record('installationToken', installationId, options);
    return this.run(() => {
      if (!this.installations.has(installationId)) throw githubUnavailable();
      return { token: `ghs_fake_${installationId}_${this.next()}`, expiresAt: new Date(Date.now() + HOUR).toISOString() };
    });
  }

  listInstallationRepositories(installationId: number): Promise<RepoRef[]> {
    this.record('listInstallationRepositories', installationId);
    return this.run(() => {
      if (!this.installations.has(installationId)) throw githubUnavailable();
      return [...this.repos.values()].filter((repo) => repo.installationId === installationId).map((repo) => repo.ref);
    });
  }

  // --- GitHubClient: metadata

  listLabels(repo: RepoRef): Promise<Label[]> {
    this.record('listLabels', repo);
    return this.run(() => [...this.repo(repo).labels.values()]);
  }

  getBranch(repo: RepoRef, name: string): Promise<Branch | null> {
    this.record('getBranch', repo, name);
    return this.run(() => {
      const branch = this.repo(repo).branches.get(name);
      return branch === undefined ? null : { name, sha: branch.sha, protected: branch.protected };
    });
  }

  getDefaultBranch(repo: RepoRef): Promise<string> {
    this.record('getDefaultBranch', repo);
    return this.run(() => this.repo(repo).defaultBranch);
  }

  listIssues(repo: RepoRef, query: IssueQuery): Promise<IssuePage> {
    this.record('listIssues', repo, query);
    return this.run(() => {
      const since = query.since === undefined ? undefined : Date.parse(query.since);
      const issues = [...this.repo(repo).issues.values()]
        .filter((issue) => query.state === 'all' || issue.state === query.state)
        .filter((issue) => since === undefined || Date.parse(issue.updatedAt) >= since)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.number - a.number);
      const page = Number(query.cursor ?? '1');
      const items = issues.slice((page - 1) * 100, page * 100).map(toIssue);
      return { items, nextCursor: issues.length > page * 100 ? String(page + 1) : null };
    });
  }

  getPullRequest(repo: RepoRef, number: number): Promise<PullRequest | null> {
    this.record('getPullRequest', repo, number);
    return this.run(() => {
      const pr = this.repo(repo).pullRequests.get(number);
      return pr === undefined ? null : toPullRequest(pr);
    });
  }

  listCheckRuns(repo: RepoRef, sha: string): Promise<CheckRun[]> {
    this.record('listCheckRuns', repo, sha);
    return this.run(() => [...(this.repo(repo).checkRuns.get(sha) ?? [])]);
  }

  getCombinedStatus(repo: RepoRef, sha: string): Promise<CombinedStatus> {
    this.record('getCombinedStatus', repo, sha);
    return this.run(() => this.repo(repo).statuses.get(sha) ?? { state: 'pending', statuses: [] });
  }

  listSubIssues(repo: RepoRef, number: number): Promise<Issue[]> {
    this.record('listSubIssues', repo, number);
    return this.run(() => {
      const fake = this.repo(repo);
      return this.issue(fake, number).subIssues.flatMap((sub) => {
        const issue = fake.issues.get(sub);
        return issue === undefined ? [] : [toIssue(issue)];
      });
    });
  }

  listIssueDependencies(repo: RepoRef, number: number): Promise<IssueRef[]> {
    this.record('listIssueDependencies', repo, number);
    return this.run(() => [...this.issue(this.repo(repo), number).blockedBy]);
  }

  // --- GitHubClient: the allowlist of contents

  readProcessJson(repo: RepoRef, ref: string): Promise<unknown> {
    this.record('readProcessJson', repo, ref);
    return this.run(() => {
      const fake = this.repo(repo);
      const sha = this.resolve(fake, ref);
      const content = sha === undefined ? undefined : this.files(sha).get('.process.json');
      if (content === undefined) return null;
      try {
        return JSON.parse(typeof content === 'string' ? content : Buffer.from(content).toString('utf8')) as unknown;
      } catch {
        throw processJsonInvalid();
      }
    });
  }

  pathExists(repo: RepoRef, ref: string, path: 'CONTEXT.md' | 'docs/adr'): Promise<boolean> {
    this.record('pathExists', repo, ref, path);
    return this.run(() => {
      const sha = this.resolve(this.repo(repo), ref);
      if (sha === undefined) return false;
      return [...this.files(sha).keys()].some((file) => file === path || file.startsWith(`${path}/`));
    });
  }

  // --- GitHubClient: writes

  ensureLabel(repo: RepoRef, label: LabelInput): Promise<Label> {
    this.record('ensureLabel', repo, label);
    return this.run(() => {
      const saved: Label = { name: label.name, color: label.color, description: label.description };
      this.repo(repo).labels.set(label.name, saved);
      return saved;
    });
  }

  createBranch(repo: RepoRef, name: string, fromSha: string): Promise<void> {
    this.record('createBranch', repo, name, fromSha);
    return this.run(() => {
      const fake = this.repo(repo);
      if (fake.branches.has(name) || !this.commits.has(fromSha)) throw githubUnavailable();
      fake.branches.set(name, { sha: fromSha, protected: false });
    });
  }

  commitProcessJson(repo: RepoRef, branch: string, content: string, message: string): Promise<CommitRef> {
    this.record('commitProcessJson', repo, branch, content, message);
    return this.run(() => {
      const fake = this.repo(repo);
      const current = this.writableBranch(fake, branch);
      const sha = this.commit(new Map([...this.files(current.sha), ['.process.json', content]]), [current.sha]);
      this.moveBranch(fake, branch, sha);
      return { sha };
    });
  }

  createPullRequest(repo: RepoRef, pullRequest: NewPullRequest): Promise<PullRequest> {
    this.record('createPullRequest', repo, pullRequest);
    return this.run(() => {
      const fake = this.repo(repo);
      const head = fake.branches.get(pullRequest.head);
      if (head === undefined || !fake.branches.has(pullRequest.base)) throw githubUnavailable();
      const pr: FakePullRequest = {
        number: fake.nextNumber++,
        title: pullRequest.title,
        state: 'open',
        draft: pullRequest.draft,
        merged: false,
        headRef: pullRequest.head,
        headSha: head.sha,
        baseRef: pullRequest.base,
        labels: [],
        updatedAt: new Date().toISOString(),
        body: '',
        files: [],
      };
      fake.pullRequests.set(pr.number, pr);
      return toPullRequest(pr);
    });
  }

  mergePullRequest(repo: RepoRef, number: number, options: MergeOptions): Promise<CommitRef> {
    this.record('mergePullRequest', repo, number, options);
    return this.run(() => {
      const fake = this.repo(repo);
      const pr = fake.pullRequests.get(number);
      if (pr === undefined || pr.state !== 'open') throw githubUnavailable();
      if (pr.headSha !== options.sha) throw headMoved();
      const sha = this.merge(fake, pr.baseRef, pr.headSha);
      Object.assign(pr, { state: 'closed', merged: true, updatedAt: new Date().toISOString() });
      return { sha };
    });
  }

  mergeBranch(repo: RepoRef, merge: BranchMerge): Promise<CommitRef> {
    this.record('mergeBranch', repo, merge);
    return this.run(() => {
      const fake = this.repo(repo);
      const base = this.writableBranch(fake, merge.base);
      if (!this.commits.has(merge.headSha)) throw githubUnavailable();
      if (this.ancestors(base.sha).has(merge.headSha)) return { sha: base.sha };
      return { sha: this.merge(fake, merge.base, merge.headSha) };
    });
  }

  addLabels(repo: RepoRef, number: number, labels: string[]): Promise<void> {
    this.record('addLabels', repo, number, labels);
    return this.run(() => {
      const fake = this.repo(repo);
      const target = this.labelled(fake, number);
      for (const label of labels) {
        if (!target.labels.includes(label)) target.labels.push(label);
        if (!fake.labels.has(label)) fake.labels.set(label, { name: label, color: 'ededed', description: null });
      }
    });
  }

  removeLabel(repo: RepoRef, number: number, label: string): Promise<void> {
    this.record('removeLabel', repo, number, label);
    return this.run(() => {
      const target = this.labelled(this.repo(repo), number);
      target.labels = target.labels.filter((name) => name !== label);
    });
  }

  createIssueComment(repo: RepoRef, number: number, body: string): Promise<void> {
    this.record('createIssueComment', repo, number, body);
    return this.run(() => {
      const fake = this.repo(repo);
      this.labelled(fake, number);
      fake.comments.push({ number, body });
    });
  }

  // --- The plumbing

  private record(method: keyof GitHubClient, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  /** What GitHub's network would do to a call: an answer or an error, always asynchronous. */
  private async run<T>(fn: () => T): Promise<T> {
    await Promise.resolve();
    return fn();
  }

  private next(): number {
    this.counter += 1;
    return this.counter;
  }

  private key(repo: Pick<RepoRef, 'owner' | 'name'>): string {
    return `${repo.owner}/${repo.name}`;
  }

  /** The repository, or `github.unavailable` as the App gets for one it is not installed on. */
  private repo(repo: RepoRef): FakeRepo {
    const fake = this.repos.get(this.key(repo));
    if (fake === undefined) throw githubUnavailable();
    return fake;
  }

  private issue(fake: FakeRepo, number: number): FakeIssue {
    const issue = fake.issues.get(number);
    if (issue === undefined) throw githubUnavailable();
    return issue;
  }

  /** An issue or a PR: they share their numbers and their labels, as on GitHub. */
  private labelled(fake: FakeRepo, number: number): { labels: string[] } {
    const target = fake.issues.get(number) ?? fake.pullRequests.get(number);
    if (target === undefined) throw githubUnavailable();
    return target;
  }

  private writableBranch(fake: FakeRepo, name: string): { sha: string; protected: boolean } {
    const branch = fake.branches.get(name);
    if (branch === undefined) throw githubUnavailable();
    if (branch.protected) throw branchProtected();
    return branch;
  }

  private commit(files: Files, parents: readonly string[] = []): string {
    const sha = createHash('sha1').update(`fake-commit-${this.next()}`).digest('hex');
    this.commits.set(sha, { files, parents });
    return sha;
  }

  /** Every write of a branch goes here: the open PRs of that head move with it, as on GitHub. */
  private moveBranch(fake: FakeRepo, name: string, sha: string): void {
    const branch = fake.branches.get(name);
    if (branch === undefined) throw githubUnavailable();
    branch.sha = sha;
    for (const pr of fake.pullRequests.values()) if (pr.state === 'open' && pr.headRef === name) pr.headSha = sha;
  }

  /**
   * A merge commit of `headSha` into `base`, from their common ancestor: each
   * side keeps what the other did not change; a file both changed apart is a
   * conflict, `github.unavailable` as the real client maps GitHub's 405 or 409.
   */
  private merge(fake: FakeRepo, base: string, headSha: string): string {
    const baseSha = this.head(fake, base);
    const ancestor = this.mergeBase(baseSha, headSha);
    const from: Files = ancestor === undefined ? new Map() : this.files(ancestor);
    const [ours, theirs] = [this.files(baseSha), this.files(headSha)];
    const merged = new Map<string, FileContent>();
    for (const path of new Set([...ours.keys(), ...theirs.keys()])) {
      const [was, mine, other] = [from.get(path), ours.get(path), theirs.get(path)];
      const content = sameContent(other, was) ? mine : sameContent(mine, was) || sameContent(mine, other) ? other : CONFLICT;
      if (content === CONFLICT) throw githubUnavailable();
      if (content !== undefined) merged.set(path, content);
    }
    const sha = this.commit(merged, [baseSha, headSha]);
    this.moveBranch(fake, base, sha);
    return sha;
  }

  /** The commit and all those it comes from. */
  private ancestors(sha: string): Set<string> {
    const seen = new Set<string>();
    for (const queue = [sha]; queue.length > 0; ) {
      const next = queue.shift() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(this.commits.get(next)?.parents ?? []));
    }
    return seen;
  }

  /** The nearest commit both come from, breadth first from `b`. */
  private mergeBase(a: string, b: string): string | undefined {
    const ofA = this.ancestors(a);
    return [...this.ancestors(b)].find((sha) => ofA.has(sha));
  }

  private head(fake: FakeRepo, branch: string): string {
    const head = fake.branches.get(branch);
    if (head === undefined) throw githubUnavailable();
    return head.sha;
  }

  private files(sha: string): Files {
    return this.commits.get(sha)?.files ?? new Map();
  }

  private pageRef(owner: string, name: string, ref: string | undefined): string | undefined {
    const fake = this.repos.get(`${owner}/${name}`);
    return fake && this.resolve(fake, ref ?? fake.defaultBranch);
  }

  /** A branch's head or a SHA of this repository's. */
  private resolve(fake: FakeRepo, ref: string): string | undefined {
    return fake.branches.get(ref)?.sha ?? (this.commits.has(ref) ? ref : undefined);
  }

  private tokensFor(userId: number | undefined): UserTokens {
    if (userId === undefined || !this.users.has(userId)) throw githubUnavailable();
    const n = this.next();
    const accessToken = `ghu_fake_${n}`;
    const refreshToken = `ghr_fake_${n}`;
    this.accessTokens.set(accessToken, userId);
    this.refreshTokens.set(refreshToken, userId);
    const now = Date.now();
    return {
      accessToken,
      accessTokenExpiresAt: new Date(now + 8 * HOUR).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: new Date(now + 184 * 24 * HOUR).toISOString(),
    };
  }
}

const CONFLICT = Symbol('conflict');

const sameContent = (a: FileContent | undefined, b: FileContent | undefined): boolean =>
  a === undefined || b === undefined ? a === b : Buffer.from(a).equals(Buffer.from(b));

const toIssue = (issue: FakeIssue): Issue => ({
  number: issue.number,
  title: issue.title,
  state: issue.state,
  labels: [...issue.labels],
  milestone: issue.milestone && { ...issue.milestone },
  updatedAt: issue.updatedAt,
});

const toPullRequest = (pr: FakePullRequest): PullRequest => ({
  number: pr.number,
  title: pr.title,
  state: pr.state,
  draft: pr.draft,
  merged: pr.merged,
  headRef: pr.headRef,
  headSha: pr.headSha,
  baseRef: pr.baseRef,
  labels: [...pr.labels],
  updatedAt: pr.updatedAt,
});
