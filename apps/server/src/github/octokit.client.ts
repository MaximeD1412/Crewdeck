import type {
  Branch,
  BranchMerge,
  CheckRun,
  CombinedStatus,
  CommitRef,
  GitHubUser,
  InstallationRepository,
  InstallationToken,
  InstallationTokenOptions,
  Issue,
  IssuePage,
  IssueQuery,
  IssueRef,
  Label,
  LabelInput,
  MergeOptions,
  NewPullRequest,
  PullRequest,
  RepoRef,
  UserTokens,
} from '@crewdeck/contracts';
import { zCheckRun, zStatusState } from '@crewdeck/contracts';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import type { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { branchProtected, githubUnavailable, headMoved, installationGone, processJsonInvalid, userTokenRefused } from './github.errors.js';
import type { GitHubClient } from './github.client.js';
import { GitHubReadForbiddenError, installReadGuard } from './read-guard.js';

type Logger = Pick<PinoLogger, 'error' | 'warn'>;

interface Response {
  status: number;
  data: unknown;
  headers: Record<string, string | number | undefined>;
}
type Request = (route: string, parameters?: Record<string, unknown>) => Promise<Response>;

/**
 * Retried by the retry plugin on a 5xx, never on what a retry cannot change:
 * GitHub's defaults, plus 405 and 409, a merge whose head moved.
 */
const DO_NOT_RETRY = [400, 401, 403, 404, 405, 409, 410, 422, 451];

const ClientOctokit = Octokit.plugin(retry, throttling);

/** GitHub's own shapes, reduced to the metadata the contracts keep: unknown keys (a body) are dropped. */
const zRawLabelName = z.union([z.string(), z.object({ name: z.string() })]).transform((label) => (typeof label === 'string' ? label : label.name));
const zRawLabel = z.object({ name: z.string(), color: z.string(), description: z.string().nullable().default(null) });
const zRawIssue = z.object({
  number: z.int(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  labels: z.array(zRawLabelName),
  milestone: z.object({ number: z.int(), title: z.string() }).nullable().default(null),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
  repository_url: z.string().optional(),
});
const zRawPullRequest = z.object({
  number: z.int(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().default(false),
  merged: z.boolean().default(false),
  merged_at: z.string().nullable().optional(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string() }),
  labels: z.array(zRawLabelName),
  updated_at: z.string(),
});
const zRawRepository = z.object({ id: z.int(), name: z.string(), owner: z.object({ login: z.string() }), private: z.boolean() });
const zRawContent = z.object({ sha: z.string().optional(), content: z.string().optional(), encoding: z.string().optional() });
const zRawTokens = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  refresh_token_expires_in: z.number(),
});

const toIssue = (raw: z.infer<typeof zRawIssue>): Issue => ({
  number: raw.number,
  title: raw.title,
  state: raw.state,
  labels: raw.labels,
  milestone: raw.milestone && { number: raw.milestone.number, title: raw.milestone.title },
  updatedAt: raw.updated_at,
});

const toPullRequest = (raw: z.infer<typeof zRawPullRequest>): PullRequest => ({
  number: raw.number,
  title: raw.title,
  state: raw.state,
  draft: raw.draft,
  merged: raw.merged || Boolean(raw.merged_at),
  headRef: raw.head.ref,
  headSha: raw.head.sha,
  baseRef: raw.base.ref,
  labels: raw.labels,
  updatedAt: raw.updated_at,
});

const toLabel = (raw: z.infer<typeof zRawLabel>): Label => ({ name: raw.name, color: raw.color, description: raw.description });

/** The page number of the `rel="next"` link, or null on the last page. */
const nextPage = (headers: Response['headers']): string | null => {
  const link = headers['link'];
  if (typeof link !== 'string') return null;
  const next = link.split(',').find((part) => /rel="next"/.test(part));
  const url = next && /<([^>]+)>/.exec(next)?.[1];
  return url ? new URL(url).searchParams.get('page') : null;
};

/** A failed request of Octokit (`RequestError`), duck-typed. */
interface GitHubFailure {
  status: number;
  message: string;
  response?: { headers?: Record<string, string | number | undefined>; data?: unknown };
  request?: { url?: string };
}
const isFailure = (error: unknown): error is GitHubFailure =>
  typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number';

const messageOf = (failure: GitHubFailure): string => {
  const data = failure.response?.data;
  const message = typeof data === 'object' && data !== null ? (data as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message : failure.message;
};

const HEAD_MOVED = /head branch was modified/i;
const PROTECTED = /protected branch|branch protection|rule violations|must be made through a pull request|required status check|approving review/i;

const INSTALLATION_TOKEN_ROUTE = /\/app\/installations\/\d+\/access_tokens$/;

/** A failure that says the installation is gone: its token refused (401), or no token for it (404). Nothing was done. */
const isStaleInstallation = (error: unknown): boolean =>
  isFailure(error) && (error.status === 401 || (error.status === 404 && INSTALLATION_TOKEN_ROUTE.test(error.request?.url ?? '')));

/** GitHub's 404 to an installation's token: it has no such installation (uninstalled). */
const isInstallationNotFound = (error: unknown): boolean => isFailure(error) && error.status === 404 && INSTALLATION_TOKEN_ROUTE.test(error.request?.url ?? '');

/** GitHub's answer to the commits of a repository without any: a 409. */
const isEmptyRepository = (error: unknown): boolean => isFailure(error) && error.status === 409;

/** A resource GitHub does not have: never the 404 of an installation's token, which says the installation is gone. */
const isNotFound = (error: unknown): boolean =>
  isFailure(error) && error.status === 404 && !INSTALLATION_TOKEN_ROUTE.test(error.request?.url ?? '');

/**
 * The `GitHubClient` on GitHub's REST API, as the App (ADR 0002): a JWT for
 * the App's routes, an installation token for a repository's, the user's
 * token for `/user`. Every Octokit it builds carries the read guard. GitHub's
 * failures become the three errors of `GitHubClient`; what is logged of one
 * is GitHub's request id and its status, never its message.
 */
export class OctokitGitHubClient implements GitHubClient {
  private appOctokit: InstanceType<typeof ClientOctokit> | undefined;
  private readonly installations = new Map<number, InstanceType<typeof ClientOctokit>>();
  /** The installation of each repository, by its id. */
  private readonly installationOf = new Map<number, number>();
  private readonly api: InstanceType<typeof ClientOctokit>;
  private readonly web: InstanceType<typeof ClientOctokit>;

  constructor(
    private readonly env: Env,
    private readonly logger: Logger,
  ) {
    this.api = this.octokit({ baseUrl: env.GITHUB_API_URL });
    this.web = this.octokit({ baseUrl: env.GITHUB_WEB_URL });
  }

  // --- The user authorization

  authorizeUrl(state: string, redirectUri: string): string {
    const url = new URL('/login/oauth/authorize', this.env.GITHUB_WEB_URL);
    url.search = new URLSearchParams({ client_id: this.oauthApp().clientId, redirect_uri: redirectUri, state }).toString();
    return url.toString();
  }

  exchangeCode(code: string, redirectUri: string): Promise<UserTokens> {
    return this.userTokens({ code, redirect_uri: redirectUri });
  }

  refreshUserToken(refreshToken: string): Promise<UserTokens> {
    return this.userTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  getAuthenticatedUser(accessToken: string): Promise<GitHubUser> {
    return this.call(async () => {
      const { data } = await this.request(this.api)('GET /user', { headers: { authorization: `token ${accessToken}` } });
      const user = z.object({ id: z.int(), login: z.string(), avatar_url: z.string() }).parse(data);
      return { id: user.id, login: user.login, avatarUrl: user.avatar_url };
    });
  }

  // --- Installations

  installationToken(installationId: number, options: InstallationTokenOptions = {}): Promise<InstallationToken> {
    return this.call(async () => {
      const app = this.app();
      const auth = (await app.auth({
        type: 'installation',
        installationId,
        repositoryIds: options.repositoryIds,
        permissions: options.permissions,
        refresh: true,
      })) as { token: string; expiresAt: string };
      return { token: auth.token, expiresAt: auth.expiresAt };
    });
  }

  listInstallationRepositories(installationId: number): Promise<InstallationRepository[]> {
    return this.call(async () => {
      try {
        const raws = await this.all(this.request(this.forInstallation(installationId)), 'GET /installation/repositories', {}, (data) =>
          z.object({ repositories: z.array(zRawRepository) }).parse(data).repositories,
        );
        return raws.map((raw) => ({ owner: raw.owner.login, name: raw.name, id: raw.id, private: raw.private }));
      } catch (error) {
        if (isInstallationNotFound(error)) throw installationGone();
        throw error;
      }
    });
  }

  // --- Metadata

  listLabels(repo: RepoRef): Promise<Label[]> {
    return this.onRepo(repo, async (request) =>
      (await this.all(request, 'GET /repos/{owner}/{repo}/labels', this.params(repo), (data) => z.array(zRawLabel).parse(data))).map(toLabel),
    );
  }

  getBranch(repo: RepoRef, name: string): Promise<Branch | null> {
    return this.onRepo(repo, async (request) => {
      try {
        const { data } = await request('GET /repos/{owner}/{repo}/branches/{branch}', { ...this.params(repo), branch: name });
        const branch = z.object({ name: z.string(), commit: z.object({ sha: z.string() }), protected: z.boolean() }).parse(data);
        return { name: branch.name, sha: branch.commit.sha, protected: branch.protected };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    });
  }

  getDefaultBranch(repo: RepoRef): Promise<string> {
    return this.onRepo(repo, async (request) => {
      const { data } = await request('GET /repos/{owner}/{repo}', this.params(repo));
      return z.object({ default_branch: z.string() }).parse(data).default_branch;
    });
  }

  countCommits(repo: RepoRef, branch: string, max: number): Promise<number> {
    return this.onRepo(repo, async (request) => {
      try {
        // Only the length is kept: a commit's message and author are never read.
        const { data } = await request('GET /repos/{owner}/{repo}/commits', { ...this.params(repo), sha: branch, per_page: max });
        return Math.min(z.array(z.unknown()).parse(data).length, max);
      } catch (error) {
        if (isEmptyRepository(error)) return 0;
        throw error;
      }
    });
  }

  listIssues(repo: RepoRef, query: IssueQuery): Promise<IssuePage> {
    return this.onRepo(repo, async (request) => {
      const response = await request('GET /repos/{owner}/{repo}/issues', {
        ...this.params(repo),
        state: query.state,
        ...(query.since === undefined ? {} : { since: query.since }),
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
        page: Number(query.cursor ?? '1'),
      });
      const raws = z.array(zRawIssue).parse(response.data);
      return { items: raws.filter((raw) => raw.pull_request === undefined).map(toIssue), nextCursor: nextPage(response.headers) };
    });
  }

  getPullRequest(repo: RepoRef, number: number): Promise<PullRequest | null> {
    return this.onRepo(repo, async (request) => {
      try {
        const { data } = await request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { ...this.params(repo), pull_number: number });
        return toPullRequest(zRawPullRequest.parse(data));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    });
  }

  listCheckRuns(repo: RepoRef, sha: string): Promise<CheckRun[]> {
    return this.onRepo(repo, async (request) => {
      const runs = await this.all(request, 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs', { ...this.params(repo), ref: sha }, (data) =>
        z.object({ check_runs: z.array(zCheckRun) }).parse(data).check_runs,
      );
      return runs.map((run) => ({ id: run.id, name: run.name, status: run.status, conclusion: run.conclusion }));
    });
  }

  getCombinedStatus(repo: RepoRef, sha: string): Promise<CombinedStatus> {
    return this.onRepo(repo, async (request) => {
      const { data } = await request('GET /repos/{owner}/{repo}/commits/{ref}/status', { ...this.params(repo), ref: sha, per_page: 100 });
      const status = z.object({ state: zStatusState, statuses: z.array(z.object({ context: z.string(), state: zStatusState })) }).parse(data);
      return { state: status.state, statuses: status.statuses.map((one) => ({ context: one.context, state: one.state })) };
    });
  }

  listSubIssues(repo: RepoRef, number: number): Promise<Issue[]> {
    return this.onRepo(repo, async (request) =>
      (
        await this.all(request, 'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', { ...this.params(repo), issue_number: number }, (data) =>
          z.array(zRawIssue).parse(data),
        )
      ).map(toIssue),
    );
  }

  listIssueDependencies(repo: RepoRef, number: number): Promise<IssueRef[]> {
    return this.onRepo(repo, async (request) => {
      const raws = await this.all(
        request,
        'GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by',
        { ...this.params(repo), issue_number: number },
        (data) => z.array(zRawIssue).parse(data),
      );
      return raws.map((raw) => {
        const [owner, name] = new URL(raw.repository_url ?? `https://x/repos/${repo.owner}/${repo.name}`).pathname.split('/').slice(-2);
        return { owner: owner ?? repo.owner, name: name ?? repo.name, number: raw.number, state: raw.state };
      });
    });
  }

  // --- The allowlist of contents

  readProcessJson(repo: RepoRef, ref: string): Promise<unknown> {
    return this.onRepo(repo, async (request) => {
      const file = await this.contents(request, repo, '.process.json', ref);
      if (file === null) return null;
      try {
        return JSON.parse(Buffer.from(file.content ?? '', 'base64').toString('utf8')) as unknown;
      } catch {
        throw processJsonInvalid();
      }
    });
  }

  pathExists(repo: RepoRef, ref: string, path: 'CONTEXT.md' | 'docs/adr'): Promise<boolean> {
    return this.onRepo(repo, async (request) => (await this.contents(request, repo, path, ref)) !== null);
  }

  // --- Writes

  ensureLabel(repo: RepoRef, label: LabelInput): Promise<Label> {
    return this.onRepo(repo, async (request) => {
      try {
        const { data } = await request('POST /repos/{owner}/{repo}/labels', { ...this.params(repo), ...label });
        return toLabel(zRawLabel.parse(data));
      } catch (error) {
        if (!isFailure(error) || error.status !== 422 || !JSON.stringify(error.response?.data ?? '').includes('already_exists')) throw error;
        const { data } = await request('PATCH /repos/{owner}/{repo}/labels/{name}', {
          ...this.params(repo),
          name: label.name,
          color: label.color,
          description: label.description,
        });
        return toLabel(zRawLabel.parse(data));
      }
    });
  }

  createBranch(repo: RepoRef, name: string, fromSha: string): Promise<void> {
    return this.onRepo(repo, async (request) => {
      await request('POST /repos/{owner}/{repo}/git/refs', { ...this.params(repo), ref: `refs/heads/${name}`, sha: fromSha });
    });
  }

  commitProcessJson(repo: RepoRef, branch: string, content: string, message: string): Promise<CommitRef> {
    return this.onRepo(repo, async (request) => {
      const current = await this.contents(request, repo, '.process.json', branch);
      const { data } = await request('PUT /repos/{owner}/{repo}/contents/{path}', {
        ...this.params(repo),
        path: '.process.json',
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        ...(current?.sha === undefined ? {} : { sha: current.sha }),
      });
      return { sha: z.object({ commit: z.object({ sha: z.string() }) }).parse(data).commit.sha };
    });
  }

  createPullRequest(repo: RepoRef, pullRequest: NewPullRequest): Promise<PullRequest> {
    return this.onRepo(repo, async (request) => {
      const { data } = await request('POST /repos/{owner}/{repo}/pulls', { ...this.params(repo), ...pullRequest });
      return toPullRequest(zRawPullRequest.parse(data));
    });
  }

  mergePullRequest(repo: RepoRef, number: number, options: MergeOptions): Promise<CommitRef> {
    return this.onRepo(repo, async (request) => {
      const { data } = await request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
        ...this.params(repo),
        pull_number: number,
        sha: options.sha,
        merge_method: options.method,
      });
      return { sha: z.object({ sha: z.string() }).parse(data).sha };
    });
  }

  mergeBranch(repo: RepoRef, merge: BranchMerge): Promise<CommitRef> {
    return this.onRepo(repo, async (request) => {
      const response = await request('POST /repos/{owner}/{repo}/merges', {
        ...this.params(repo),
        base: merge.base,
        head: merge.headSha,
        commit_message: merge.message,
      });
      if (response.status === 201) return { sha: z.object({ sha: z.string() }).parse(response.data).sha };
      // 204: the base already contains the head, its own head is the result.
      const { data } = await request('GET /repos/{owner}/{repo}/branches/{branch}', { ...this.params(repo), branch: merge.base });
      return { sha: z.object({ commit: z.object({ sha: z.string() }) }).parse(data).commit.sha };
    });
  }

  addLabels(repo: RepoRef, number: number, labels: string[]): Promise<void> {
    return this.onRepo(repo, async (request) => {
      await request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', { ...this.params(repo), issue_number: number, labels });
    });
  }

  removeLabel(repo: RepoRef, number: number, label: string): Promise<void> {
    return this.onRepo(repo, async (request) => {
      try {
        await request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', { ...this.params(repo), issue_number: number, name: label });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    });
  }

  createIssueComment(repo: RepoRef, number: number, body: string): Promise<void> {
    return this.onRepo(repo, async (request) => {
      await request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', { ...this.params(repo), issue_number: number, body });
    });
  }

  // --- The plumbing

  private octokit(options: { baseUrl: string; auth?: Record<string, unknown> }): InstanceType<typeof ClientOctokit> {
    const silent = (): void => undefined;
    const octokit = new ClientOctokit({
      baseUrl: options.baseUrl,
      ...(options.auth === undefined ? {} : { authStrategy: createAppAuth, auth: options.auth }),
      retry: { doNotRetry: DO_NOT_RETRY },
      throttle: {
        // Once on the primary limit, never on the secondary one: it means the server writes too fast.
        onRateLimit: (_after: number, _options: unknown, _octokit: unknown, retryCount: number) => retryCount < 1,
        onSecondaryRateLimit: () => false,
      },
      log: { debug: silent, info: silent, warn: silent, error: silent },
    });
    installReadGuard(octokit);
    return octokit;
  }

  private request(octokit: InstanceType<typeof ClientOctokit>): Request {
    return octokit.request as unknown as Request;
  }

  /** The App's key and id, or `github.unavailable` where the environment has none (development without the fakes). */
  private appCredentials(): { appId: string; privateKey: string } {
    const { GITHUB_APP_ID: appId, GITHUB_APP_PRIVATE_KEY: privateKey } = this.env;
    if (appId === undefined || privateKey === undefined) throw this.notConfigured();
    return { appId, privateKey };
  }

  private oauthApp(): { clientId: string; clientSecret: string } {
    const { GITHUB_APP_CLIENT_ID: clientId, GITHUB_APP_CLIENT_SECRET: clientSecret } = this.env;
    if (clientId === undefined || clientSecret === undefined) throw this.notConfigured();
    return { clientId, clientSecret };
  }

  private notConfigured(): AppError {
    this.logger.warn('GitHub App not configured: set GITHUB_APP_*, or CREWDECK_FAKES=1');
    return githubUnavailable();
  }

  private app(): InstanceType<typeof ClientOctokit> {
    this.appOctokit ??= this.octokit({ baseUrl: this.env.GITHUB_API_URL, auth: this.appCredentials() });
    return this.appOctokit;
  }

  private forInstallation(installationId: number): InstanceType<typeof ClientOctokit> {
    let octokit = this.installations.get(installationId);
    if (octokit === undefined) {
      octokit = this.octokit({ baseUrl: this.env.GITHUB_API_URL, auth: { ...this.appCredentials(), installationId } });
      this.installations.set(installationId, octokit);
    }
    return octokit;
  }

  /**
   * Runs `fn` with the installation of `repo`, found with the App's JWT and
   * remembered. A remembered one GitHub no longer knows (the App reinstalled:
   * its token refused, or its token's route a 404) is forgotten and looked up
   * again, once.
   */
  private onRepo<T>(repo: RepoRef, fn: (request: Request) => Promise<T>): Promise<T> {
    return this.call(async () => {
      const remembered = this.installationOf.get(repo.id);
      if (remembered !== undefined) {
        try {
          return await fn(this.request(this.forInstallation(remembered)));
        } catch (error) {
          if (!isStaleInstallation(error)) throw error;
          this.installationOf.delete(repo.id);
          this.installations.delete(remembered);
        }
      }
      const { data } = await this.request(this.app())('GET /repos/{owner}/{repo}/installation', this.params(repo));
      const installationId = z.object({ id: z.int() }).parse(data).id;
      this.installationOf.set(repo.id, installationId);
      return fn(this.request(this.forInstallation(installationId)));
    });
  }

  private params(repo: RepoRef): { owner: string; repo: string } {
    return { owner: repo.owner, repo: repo.name };
  }

  /** A file or a directory of the allowlist at `ref`, or null when it does not exist. */
  private async contents(request: Request, repo: RepoRef, path: string, ref: string): Promise<z.infer<typeof zRawContent> | null> {
    try {
      const { data } = await request('GET /repos/{owner}/{repo}/contents/{path}', { ...this.params(repo), path, ref });
      return Array.isArray(data) ? {} : zRawContent.parse(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Every page of a list, 100 at a time. */
  private async all<T>(request: Request, route: string, parameters: Record<string, unknown>, items: (data: unknown) => T[]): Promise<T[]> {
    const result: T[] = [];
    for (let page: string | null = '1'; page !== null; ) {
      const response = await request(route, { ...parameters, per_page: 100, page: Number(page) });
      result.push(...items(response.data));
      page = nextPage(response.headers);
    }
    return result;
  }

  private userTokens(grant: Record<string, string>): Promise<UserTokens> {
    return this.call(async () => {
      const { clientId, clientSecret } = this.oauthApp();
      const { data } = await this.request(this.web)('POST /login/oauth/access_token', {
        client_id: clientId,
        client_secret: clientSecret,
        ...grant,
        headers: { accept: 'application/json' },
      });
      const parsed = zRawTokens.safeParse(data);
      if (!parsed.success) {
        // A refused code comes back as a 200 with an `error`; nothing of it is logged but its code.
        const code = z.object({ error: z.string() }).safeParse(data);
        this.logger.warn({ oauthError: code.success ? code.data.error : 'unexpected shape' }, 'GitHub refused the user authorization');
        if (code.success) throw userTokenRefused();
        throw githubUnavailable();
      }
      const now = Date.now();
      return {
        accessToken: parsed.data.access_token,
        accessTokenExpiresAt: new Date(now + parsed.data.expires_in * 1000).toISOString(),
        refreshToken: parsed.data.refresh_token,
        refreshTokenExpiresAt: new Date(now + parsed.data.refresh_token_expires_in * 1000).toISOString(),
      };
    });
  }

  /** Maps GitHub's failures to the errors of `GitHubClient`. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AppError || error instanceof GitHubReadForbiddenError) throw error;
      if (isFailure(error)) {
        const message = messageOf(error);
        if ((error.status === 405 || error.status === 409) && HEAD_MOVED.test(message)) throw headMoved();
        if ([403, 405, 409, 422].includes(error.status) && PROTECTED.test(message)) throw branchProtected();
        this.logger.error({ githubRequestId: error.response?.headers?.['x-github-request-id'], status: error.status }, 'GitHub request failed');
      } else {
        this.logger.error({ cause: error instanceof Error ? error.name : typeof error }, 'GitHub request failed');
      }
      throw githubUnavailable();
    }
  }
}
