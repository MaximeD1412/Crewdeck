import type { GitHubMilestone, Issue, IssueParent, PullRequest } from '@crewdeck/contracts';
import { z } from 'zod';

/**
 * GitHub's own shapes, as its REST API and its webhooks send them, reduced to
 * the metadata the contracts keep: unknown keys (a `body`, a description) are
 * dropped by the parse, before anything stores or logs them (ADR 0003).
 */
export const zRawLabelName = z.union([z.string(), z.object({ name: z.string() })]).transform((label) => (typeof label === 'string' ? label : label.name));

export const zRawMilestone = z.object({
  number: z.int(),
  title: z.string(),
  state: z.enum(['open', 'closed']).default('open'),
  due_on: z.string().nullable().default(null),
  open_issues: z.int().nonnegative().default(0),
  closed_issues: z.int().nonnegative().default(0),
  closed_at: z.string().nullable().default(null),
});

export const zRawIssue = z.object({
  number: z.int(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  state_reason: z.enum(['completed', 'not_planned', 'duplicate', 'reopened']).nullable().catch(null).default(null),
  labels: z.array(zRawLabelName),
  milestone: zRawMilestone.nullable().default(null),
  created_at: z.string(),
  closed_at: z.string().nullable().default(null),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
  repository_url: z.string().optional(),
  /** The parent's API URL when the issue is a sub-issue; absent when GitHub does not say. */
  parent_issue_url: z.string().nullable().optional(),
});
export type RawIssue = z.infer<typeof zRawIssue>;

export const zRawPullRequest = z.object({
  number: z.int(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().default(false),
  merged: z.boolean().default(false),
  merged_at: z.string().nullable().optional(),
  merge_commit_sha: z.string().nullable().optional(),
  merged_by: z.object({ login: z.string() }).nullable().optional(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string() }),
  labels: z.array(zRawLabelName).default([]),
  created_at: z.string(),
  updated_at: z.string(),
});

/** GitHub sends `due_on` as an instant at the day's start in the repository's time zone: its day. */
const dayOf = (dueOn: string | null): string | null => (dueOn === null ? null : dueOn.slice(0, 10));

export const toMilestone = (raw: z.infer<typeof zRawMilestone>): GitHubMilestone => ({
  number: raw.number,
  title: raw.title,
  state: raw.state,
  dueOn: dayOf(raw.due_on),
  openIssues: raw.open_issues,
  closedIssues: raw.closed_issues,
  closedAt: raw.closed_at,
});

/** The parent of `parent_issue_url`: GitHub gives it on a sub-issue only, so none without it. */
const parentOfUrl = (url: string | null | undefined): IssueParent | null => {
  const of = url ? repoOfUrl(url) : null;
  return of?.number ? { owner: of.owner, name: of.name, number: of.number } : null;
};

export const toIssue = (raw: RawIssue): Issue => ({
  number: raw.number,
  title: raw.title,
  state: raw.state,
  stateReason: raw.state_reason,
  labels: raw.labels,
  milestone: raw.milestone && { number: raw.milestone.number, title: raw.milestone.title },
  parent: parentOfUrl(raw.parent_issue_url),
  createdAt: raw.created_at,
  closedAt: raw.closed_at,
  updatedAt: raw.updated_at,
});

export const toPullRequest = (raw: z.infer<typeof zRawPullRequest>): PullRequest => {
  const merged = raw.merged || Boolean(raw.merged_at);
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    draft: raw.draft,
    merged,
    headRef: raw.head.ref,
    headSha: raw.head.sha,
    baseRef: raw.base.ref,
    labels: raw.labels,
    createdAt: raw.created_at,
    mergedAt: raw.merged_at ?? null,
    // Before its merge, GitHub's `merge_commit_sha` is a test merge's: kept only once merged.
    mergeSha: merged ? (raw.merge_commit_sha ?? null) : null,
    mergedBy: raw.merged_by?.login ?? null,
    updatedAt: raw.updated_at,
  };
};

/** The owner and name of the repository of an API URL (`…/repos/<owner>/<name>` or `…/repos/<owner>/<name>/issues/<n>`). */
export const repoOfUrl = (url: string): { owner: string; name: string; number: number | null } | null => {
  const match = /\/repos\/([^/]+)\/([^/]+)(?:\/issues\/(\d+))?\/?$/.exec(new URL(url, 'https://api.github.com').pathname);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], name: match[2], number: match[3] === undefined ? null : Number(match[3]) };
};
