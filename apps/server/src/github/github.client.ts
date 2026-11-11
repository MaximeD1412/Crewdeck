import type {
  AllowlistedPath,
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
  Label,
  LabelInput,
  MergeOptions,
  NewPullRequest,
  PullRequest,
  RepoRef,
  UserTokens,
} from '@crewdeck/contracts';

/** The token of the `GitHubClient`: `@Inject(GITHUB_CLIENT) private readonly github: GitHubClient`. */
export const GITHUB_CLIENT = Symbol('GITHUB_CLIENT');

/**
 * Everything the server does on GitHub, as the « Crewdeck » GitHub App (ADR
 * 0002): metadata only. There is no method that reads an issue's or a PR's
 * body, a diff, or a file outside `.process.json`, `CONTEXT.md` and
 * `docs/adr`: what is not here cannot be called. The read guard of the real
 * client is the second fence. Every merge passes the SHA the gate judged.
 *
 * Errors are `AppError`s: `github.head-moved` (409), `github.branch-protected`
 * (422), `github.user-token-refused` (401) for a user grant GitHub refuses,
 * `github.unavailable` (500) for anything else.
 */
export interface GitHubClient {
  // --- The user authorization (sign-in, CORE-4)
  /** The page GitHub shows to authorize the App, which comes back to `redirectUri` with `code` and `state`. */
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<UserTokens>;
  refreshUserToken(refreshToken: string): Promise<UserTokens>;
  getAuthenticatedUser(accessToken: string): Promise<GitHubUser>;

  // --- Installations
  installationToken(installationId: number, options?: InstallationTokenOptions): Promise<InstallationToken>;
  listInstallationRepositories(installationId: number): Promise<RepoRef[]>;

  // --- Metadata, never a body
  listLabels(repo: RepoRef): Promise<Label[]>;
  getBranch(repo: RepoRef, name: string): Promise<Branch | null>;
  /** The name of the repository's default branch. */
  getDefaultBranch(repo: RepoRef): Promise<string>;
  /** A page of issues (PRs left out), most recently updated first. */
  listIssues(repo: RepoRef, query: IssueQuery): Promise<IssuePage>;
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequest | null>;
  listCheckRuns(repo: RepoRef, sha: string): Promise<CheckRun[]>;
  getCombinedStatus(repo: RepoRef, sha: string): Promise<CombinedStatus>;
  listSubIssues(repo: RepoRef, number: number): Promise<Issue[]>;
  /** The issues `number` is blocked by. */
  listIssueDependencies(repo: RepoRef, number: number): Promise<IssueRef[]>;

  // --- The allowlist of contents
  /** `.process.json` at `ref`, parsed; null when the file does not exist. */
  readProcessJson(repo: RepoRef, ref: string): Promise<unknown>;
  pathExists(repo: RepoRef, ref: string, path: Exclude<AllowlistedPath, '.process.json'>): Promise<boolean>;

  // --- Writes
  /** Creates the label, or updates its color and description. */
  ensureLabel(repo: RepoRef, label: LabelInput): Promise<Label>;
  createBranch(repo: RepoRef, name: string, fromSha: string): Promise<void>;
  /** One commit of `.process.json` on `branch`, the only file the server writes. */
  commitProcessJson(repo: RepoRef, branch: string, content: string, message: string): Promise<CommitRef>;
  createPullRequest(repo: RepoRef, pullRequest: NewPullRequest): Promise<PullRequest>;
  mergePullRequest(repo: RepoRef, number: number, options: MergeOptions): Promise<CommitRef>;
  /** Merges `headSha` into `base` (the merges API), one merge commit. */
  mergeBranch(repo: RepoRef, merge: BranchMerge): Promise<CommitRef>;
  addLabels(repo: RepoRef, number: number, labels: string[]): Promise<void>;
  /** Removes the label; nothing when the issue does not have it. */
  removeLabel(repo: RepoRef, number: number, label: string): Promise<void>;
  createIssueComment(repo: RepoRef, number: number, body: string): Promise<void>;
}
