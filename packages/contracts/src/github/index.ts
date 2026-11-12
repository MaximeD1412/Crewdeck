import { z } from 'zod';
import { zCursorPage, zInstant } from '../values.js';

/**
 * What the server's GitHub client returns (ADR 0002): metadata only. No type
 * here has a body, a diff or a file's content; a test checks their keys.
 * What the page reads from GitHub itself keeps GitHub's own shapes.
 */

/** A commit's SHA: 40 lowercase hexadecimal characters. */
export const zSha = z.string().regex(/^[0-9a-f]{40}$/);
export type Sha = z.infer<typeof zSha>;

/** A repository: its owner's login, its name, and GitHub's id, which survives a rename. */
export const zRepoRef = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  id: z.int().positive(),
});
export type RepoRef = z.infer<typeof zRepoRef>;

/** A repository an installation of the App can reach, and whether it is private. */
export const zInstallationRepository = zRepoRef.extend({ private: z.boolean() });
export type InstallationRepository = z.infer<typeof zInstallationRepository>;

/** A user access token of the App's user authorization (8 h) and its refresh token (6 months). */
export const zUserTokens = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: zInstant,
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: zInstant,
});
export type UserTokens = z.infer<typeof zUserTokens>;

/** The GitHub user a user token belongs to. */
export const zGitHubUser = z.object({
  id: z.int().positive(),
  login: z.string().min(1),
  avatarUrl: z.url(),
});
export type GitHubUser = z.infer<typeof zGitHubUser>;

/** A permission of an installation token, as GitHub names it (`contents`, `issues`…). */
export const zInstallationPermissions = z.record(z.string().regex(/^[a-z_]+$/), z.enum(['read', 'write']));
export type InstallationPermissions = z.infer<typeof zInstallationPermissions>;

/** What an installation token may be restricted to (ADR 0002: a Session's token, its repository only). */
export const zInstallationTokenOptions = z.object({
  repositoryIds: z.array(z.int().positive()).optional(),
  permissions: zInstallationPermissions.optional(),
});
export type InstallationTokenOptions = z.infer<typeof zInstallationTokenOptions>;

/** An installation token (1 h). */
export const zInstallationToken = z.object({
  token: z.string().min(1),
  expiresAt: zInstant,
});
export type InstallationToken = z.infer<typeof zInstallationToken>;

/** A label: its color is six hexadecimal characters, without `#`. */
export const zLabel = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^[0-9a-fA-F]{6}$/),
  description: z.string().nullable(),
});
export type Label = z.infer<typeof zLabel>;

export const zBranch = z.object({
  name: z.string().min(1),
  sha: zSha,
  protected: z.boolean(),
});
export type Branch = z.infer<typeof zBranch>;

export const zIssueState = z.enum(['open', 'closed']);
export type IssueState = z.infer<typeof zIssueState>;

export const zMilestone = z.object({
  number: z.int().positive(),
  title: z.string(),
});
export type Milestone = z.infer<typeof zMilestone>;

/** An issue's metadata: never its body. */
export const zIssue = z.object({
  number: z.int().positive(),
  title: z.string(),
  state: zIssueState,
  labels: z.array(z.string()),
  milestone: zMilestone.nullable(),
  updatedAt: zInstant,
});
export type Issue = z.infer<typeof zIssue>;

/** The query of `listIssues`: a state, issues updated since an instant, the cursor of the next page. */
export const zIssueQuery = z.object({
  state: z.enum(['open', 'closed', 'all']),
  since: zInstant.optional(),
  cursor: z.string().min(1).optional(),
});
export type IssueQuery = z.infer<typeof zIssueQuery>;

export const zIssuePage = zCursorPage(zIssue);
export type IssuePage = z.infer<typeof zIssuePage>;

/** An issue another one depends on (blocked-by), maybe in another repository. */
export const zIssueRef = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  number: z.int().positive(),
  state: zIssueState,
});
export type IssueRef = z.infer<typeof zIssueRef>;

/** A PR's metadata: never its body nor its diff. */
export const zPullRequest = z.object({
  number: z.int().positive(),
  title: z.string(),
  state: zIssueState,
  draft: z.boolean(),
  merged: z.boolean(),
  headRef: z.string().min(1),
  headSha: zSha,
  baseRef: z.string().min(1),
  labels: z.array(z.string()),
  updatedAt: zInstant,
});
export type PullRequest = z.infer<typeof zPullRequest>;

export const zNewPullRequest = z.object({
  head: z.string().min(1),
  base: z.string().min(1),
  title: z.string().min(1),
  draft: z.boolean(),
});
export type NewPullRequest = z.infer<typeof zNewPullRequest>;

/** A check run's state, never its output (its summary and text are a CI's content). */
export const zCheckRun = z.object({
  id: z.int().positive(),
  name: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending']),
  conclusion: z.enum(['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale']).nullable(),
});
export type CheckRun = z.infer<typeof zCheckRun>;

export const zStatusState = z.enum(['success', 'pending', 'failure', 'error']);
export type StatusState = z.infer<typeof zStatusState>;

/** The commit statuses of a SHA: the combined state and each context's. */
export const zCombinedStatus = z.object({
  state: zStatusState,
  statuses: z.array(z.object({ context: z.string(), state: zStatusState })),
});
export type CombinedStatus = z.infer<typeof zCombinedStatus>;

export const zLabelInput = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^[0-9a-fA-F]{6}$/),
  description: z.string(),
});
export type LabelInput = z.infer<typeof zLabelInput>;

/** A merge bound to the SHA the gate judged (ADR 0002). */
export const zMergeOptions = z.object({
  sha: zSha,
  method: z.enum(['squash', 'merge']),
});
export type MergeOptions = z.infer<typeof zMergeOptions>;

/** A merge of a head into a base through the merges API (the Inventaire's branch). */
export const zBranchMerge = z.object({
  base: z.string().min(1),
  headSha: zSha,
  message: z.string().min(1),
});
export type BranchMerge = z.infer<typeof zBranchMerge>;

/** The commit a write made. */
export const zCommitRef = z.object({ sha: zSha });
export type CommitRef = z.infer<typeof zCommitRef>;

/** The only files and directories the server may read in a repository (ADR 0002). */
export const ALLOWLISTED_PATHS = ['.process.json', 'CONTEXT.md', 'docs/adr'] as const;
export type AllowlistedPath = (typeof ALLOWLISTED_PATHS)[number];
