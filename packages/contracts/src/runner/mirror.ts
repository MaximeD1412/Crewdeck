import { z } from 'zod';
import { zErrorCode } from '../api/errors.js';
import { type InstallationPermissions, zSha } from '../github/index.js';
import { zSealedItem } from '../keys/sealed.js';
import { zSourceKind } from '../process/sources.js';
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

/**
 * One Projet of the Pilote, as the Runner's Miroir keys it (ADR 0010, ADR
 * 0012): where each of its groups lives (`sources`), its GitHub repository
 * when it has one whose access is not lost (else `repository`,
 * `githubRepoId`, `installationId` and `displayName` are null), and the
 * Local name sealed under the vault key (PROJET-6, `project:<id>:name`),
 * which only the Runner opens, null for a Projet without one. The « Miroir »
 * token and the follower use only the items with a repository.
 */
export const zMirrorProject = z.object({
  projectId: zId,
  sources: z.strictObject({ ticket: zSourceKind, code: zSourceKind }),
  repository: zRepositoryName.nullable(),
  githubRepoId: z.int().positive().nullable(),
  installationId: z.int().positive().nullable(),
  displayName: z.string().min(1).nullable(),
  nameSealed: zSealedItem.nullable(),
  integrationBranch: z.string().min(1),
});
export type MirrorProject = z.infer<typeof zMirrorProject>;

/**
 * Server → Runner: every Projet of the Pilote, before the replay and again
 * after each change of them (a Projet followed or created, its access lost or
 * back, one of its Sources moved); a Projet absent from the list is no longer
 * copied.
 */
export const zMirrorProjects = runnerMessage('mirror.projects', { projects: z.array(zMirrorProject) });
export type MirrorProjects = z.infer<typeof zMirrorProjects>;

/**
 * What the « Miroir » token may do (ADR 0010, risk SEC-6): six permissions,
 * read only. Never `write`: a Session keeps its own token for its writes.
 */
export const MIRROR_TOKEN_PERMISSIONS = {
  metadata: 'read',
  contents: 'read',
  issues: 'read',
  pull_requests: 'read',
  checks: 'read',
  statuses: 'read',
} as const satisfies InstallationPermissions;

/**
 * Runner → server: the « Miroir » tokens, asked at the start and again
 * 10 min before the earliest `expiresAt`, and after each `mirror.projects`
 * (MIROIR-4). The server never pushes one.
 */
export const zMirrorToken = runnerMessage('mirror.token');
export type MirrorToken = z.infer<typeof zMirrorToken>;

/**
 * An installation token of one App installation, restricted to the
 * repositories of the Pilote's Projets it reaches and to
 * `MIRROR_TOKEN_PERMISSIONS`, valid 1 h. Never stored nor logged by the server.
 */
export const zMirrorInstallationToken = z.object({
  installationId: z.int().positive(),
  token: z.string().min(1),
  expiresAt: zInstant,
  repositories: z.array(zRepositoryName),
});
export type MirrorInstallationToken = z.infer<typeof zMirrorInstallationToken>;

/**
 * Server → Runner: one token per installation of the Pilote's Projets that
 * have a GitHub repository whose access is not lost; `tokens: []` when there
 * is none (a Local Projet needs no token).
 */
export const zMirrorTokenIssued = runnerMessage('mirror.token.issued', { tokens: z.array(zMirrorInstallationToken) });
export type MirrorTokenIssued = z.infer<typeof zMirrorTokenIssued>;

/**
 * Server → Runner: one installation's token could not be minted
 * (`github.unavailable`: GitHub refused or did not answer); the Runner asks
 * the whole request again.
 */
export const zMirrorTokenFailed = runnerMessage('mirror.token.failed', { code: zErrorCode });
export type MirrorTokenFailed = z.infer<typeof zMirrorTokenFailed>;
