import { z } from 'zod';
import { zSha } from '../github/index.js';
import { zId, zInstant, zSeq } from '../values.js';
import { runnerMessage } from './envelope.js';

/** What a change of GitHub names (ADR 0010): the collection the Runner's Miroir fetches again. */
export const GITHUB_CHANGE_KINDS = ['issue', 'pull', 'push', 'check', 'release', 'label', 'milestone'] as const;
export const zGitHubChangeKind = z.enum(GITHUB_CHANGE_KINDS);
export type GitHubChangeKind = z.infer<typeof zGitHubChangeKind>;

/** A repository as `<owner>/<name>`. */
export const zRepositoryName = z.string().regex(/^[^/\s]+\/[^/\s]+$/);

/**
 * The envelope of one webhook of a Projet's repository, as the server keeps
 * it in `github_changes` (ADR 0010): identifiers, states and dates only,
 * never a title, a body, a label's name nor a branch other than `ref`
 * (ADR 0003). `seq` is the Pilote's own counter of these envelopes, never the
 * tabs' one; a field the webhook does not give is null. Any other key is
 * refused.
 */
export const zGitHubChange = z.strictObject({
  seq: zSeq,
  projectId: zId,
  repository: zRepositoryName,
  kind: zGitHubChangeKind,
  /** The issue's, the PR's or the milestone's number; for a check, its one PR's. */
  number: z.int().positive().nullable(),
  /** A PR's head, a check's or a status's commit, a push's `after`. */
  sha: zSha.nullable(),
  /** A push's ref (`refs/heads/develop`). */
  ref: z.string().min(1).nullable(),
  /** The webhook's `action` (`opened`, `completed`…); null for `push` and `status`. */
  action: z.string().min(1).nullable(),
  /** When the server received the webhook. */
  at: zInstant,
});
export type GitHubChange = z.infer<typeof zGitHubChange>;

/**
 * Server → Runner: one envelope, replayed after the Runner's `hello` or sent
 * live; the Runner fetches from GitHub what it names, then moves its cursor
 * to `change.seq` (`hello.mirrorAfter` at its next connection).
 */
export const zGitHubChanged = runnerMessage('github.changed', { change: zGitHubChange });
export type GitHubChanged = z.infer<typeof zGitHubChanged>;

/**
 * Server → Runner: the envelopes after the Runner's `mirrorAfter` are no
 * longer kept (7 days), or it had none: no replay, the Runner reconciles its
 * copy with GitHub; `mirror.live` follows.
 */
export const zMirrorResync = runnerMessage('mirror.resync');
export type MirrorResync = z.infer<typeof zMirrorResync>;

/**
 * Server → Runner: the replay is over, every envelope up to `seq` was sent
 * (after a `mirror.resync`, `seq` is the counter's value then); what follows
 * is live.
 */
export const zMirrorLive = runnerMessage('mirror.live', { seq: zSeq });
export type MirrorLive = z.infer<typeof zMirrorLive>;

/** One Projet of the Pilote that has a GitHub repository, as the Runner's Miroir keys it. */
export const zMirrorProject = z.object({
  projectId: zId,
  repository: zRepositoryName,
  githubRepoId: z.int().positive(),
  installationId: z.int().positive(),
  displayName: z.string().min(1),
  integrationBranch: z.string().min(1),
});
export type MirrorProject = z.infer<typeof zMirrorProject>;

/**
 * Server → Runner: the Pilote's Projets that have a GitHub repository whose
 * access is not lost, before the replay and again after each change of them;
 * a Projet absent from the list is no longer followed.
 */
export const zMirrorProjects = runnerMessage('mirror.projects', { projects: z.array(zMirrorProject) });
export type MirrorProjects = z.infer<typeof zMirrorProjects>;
