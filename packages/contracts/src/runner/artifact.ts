import { z } from 'zod';
import { zBytes, zBytes32 } from '../keys/pairing.js';
import { zId, zInstant } from '../values.js';
import { runnerMessage } from './envelope.js';
import { zNonce, zSessionKeyWrap } from './relay.js';
import { GIT_BRANCH_CHARS } from './session.js';

/**
 * Reading content in the page (SOURCE-4, ADR 0012 « Reading content in the
 * page », `docs/security/e2e.md` « Contenu lu par la page »): a document, a
 * Ticket, a change of code, a diff or a Commande's output of what lives on
 * the Pilote's machine is read through the relay, as a Session is. The tab
 * asks, the Runner answers sealed for the one Appareil that asked, the server
 * forwards and keeps nothing.
 *
 * - tab → server: `artifact.read { requestId, projectId, holderId, kind, ref }`;
 * - server → Runner: the same, with the `tabId` the server gave the tab's
 *   socket (and `ref.at` of a `file` the Projet's integration branch when the
 *   tab gave none);
 * - Runner → server: `artifact.content` (a random key wrapped for `holderId`
 *   with the additional data `"artifact:<requestId>:<holderId>"`, the content
 *   sealed under it with `"artifact:<requestId>"`) or `artifact.error`, with
 *   the `tabId`;
 * - server → tab: the same, without `tabId`; `artifact.error` also when the
 *   Projet is not the Pilote's, the Runner offline, or no answer in 30 s.
 */

/** What can be read: a file of the code, a Ticket, a change of code, a diff, a Commande's output. */
export const ARTIFACT_KINDS = ['file', 'ticket', 'change', 'diff', 'command-output'] as const;
export const zArtifactKind = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof zArtifactKind>;

/** The most bytes of an answer's plaintext (its JSON): a document, a Ticket or a diff of a Ticket; a larger one is `artifact.too-large`. */
export const ARTIFACT_PLAINTEXT_MAX = 4 * 1024 * 1024;

/** The longest ciphertext of an answer: its plaintext and GCM's tag. */
export const ARTIFACT_CIPHERTEXT_MAX = ARTIFACT_PLAINTEXT_MAX + 16;

/** How long the server waits for the Runner's answer before `artifact.timeout`. */
export const ARTIFACT_TIMEOUT_SECONDS = 30;

/**
 * A branch or a commit, as git reads it. Never starting with « - »: the
 * Runner hands it to git, which would read an option.
 */
export const zArtifactGitRef = z.string().min(1).max(255).regex(GIT_BRANCH_CHARS).regex(/^[^-]/);

/** A file's path from the repository's root, as the tab asks it: the Runner answers `artifact.not-found` to one outside it (`..`, absolute). */
export const zArtifactPath = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\0]+$/);

/**
 * What to read, by kind:
 * - `file`: `{ path, at? }`, `at` a branch or a SHA, the integration branch by default;
 * - `ticket`, `change`: `{ number }`;
 * - `diff`: `{ number }` (a change's base and head) or `{ base, head }`;
 * - `command-output`: `{ runId }`.
 *
 * One object of optional fields (so that the Runner's generated type reads
 * it), each kind's checked by `artifactRefFits`.
 */
export const zArtifactReadRef = z.strictObject({
  path: zArtifactPath.optional(),
  at: zArtifactGitRef.optional(),
  number: z.int().positive().optional(),
  base: zArtifactGitRef.optional(),
  head: zArtifactGitRef.optional(),
  runId: zId.optional(),
});
export type ArtifactReadRef = z.infer<typeof zArtifactReadRef>;

/** The `ref` of each kind, for the page. */
export interface ArtifactReadRefs {
  file: { path: string; at?: string };
  ticket: { number: number };
  change: { number: number };
  diff: { number: number } | { base: string; head: string };
  'command-output': { runId: string };
}
export type ArtifactReadRefOf<K extends ArtifactKind> = ArtifactReadRefs[K];

const refKeys: Record<ArtifactKind, readonly (readonly (keyof ArtifactReadRef)[])[]> = {
  file: [['path'], ['path', 'at']],
  ticket: [['number']],
  change: [['number']],
  diff: [['number'], ['base', 'head']],
  'command-output': [['runId']],
};

/** Whether `ref` holds the fields of `kind`, and those only. */
export const artifactRefFits = (kind: ArtifactKind, ref: ArtifactReadRef): boolean => {
  const keys = Object.keys(ref)
    .filter((key) => ref[key as keyof ArtifactReadRef] !== undefined)
    .sort();
  return refKeys[kind].some((allowed) => allowed.length === keys.length && [...allowed].sort().every((key, i) => key === keys[i]));
};

const refFits = ({ kind, ref }: { kind: ArtifactKind; ref: ArtifactReadRef }) => artifactRefFits(kind, ref);
const refMessage = { message: 'ref does not fit its kind', path: ['ref'] };

const readShape = { requestId: zId, projectId: zId, holderId: zBytes32, kind: zArtifactKind, ref: zArtifactReadRef };
const contentShape = { requestId: zId, wrap: zSessionKeyWrap, nonce: zNonce, ciphertext: zBytes(16, ARTIFACT_CIPHERTEXT_MAX) };

/**
 * Why an artefact is not read: none such, or not the Pilote's (the server's,
 * or the Runner's); more than `ARTIFACT_PLAINTEXT_MAX`; an Appareil the
 * Runner did not authenticate; the Runner offline; no answer in time.
 */
export const ARTIFACT_ERRORS = ['artifact.not-found', 'artifact.too-large', 'artifact.untrusted-device', 'artifact.runner-offline', 'artifact.timeout'] as const;
export const zArtifactErrorCode = z.enum(ARTIFACT_ERRORS);
export type ArtifactErrorCode = z.infer<typeof zArtifactErrorCode>;

/** Server → Runner: read the artefact for the tab `tabId`, sealed for `holderId`. */
export const zArtifactRead = runnerMessage('artifact.read', { ...readShape, tabId: zId }).refine(refFits, refMessage);
export type ArtifactRead = z.infer<typeof zArtifactRead>;

/** Runner → server: the artefact, sealed for the holder the tab named. */
export const zArtifactContent = runnerMessage('artifact.content', { ...contentShape, tabId: zId });
export type ArtifactContent = z.infer<typeof zArtifactContent>;

/** Runner → server: the artefact was not read. */
export const zArtifactError = runnerMessage('artifact.error', { requestId: zId, tabId: zId, code: zArtifactErrorCode });
export type ArtifactError = z.infer<typeof zArtifactError>;

/** Tab → server: read an artefact; `requestId` a UUIDv7 the tab draws, `holderId` its Appareil's public key. */
export const zTabArtifactRead = z.object({ type: z.literal('artifact.read'), ...readShape }).refine(refFits, refMessage);
/** Server → tab: the answer to `requestId`. */
export const zTabArtifactContent = z.object({ type: z.literal('artifact.content'), ...contentShape });
/** Server → tab: `requestId` was not read. */
export const zTabArtifactError = z.object({ type: z.literal('artifact.error'), requestId: zId, code: zArtifactErrorCode });

export type TabArtifactClientMessage = z.infer<typeof zTabArtifactRead>;
export const zTabArtifactServerMessage = z.discriminatedUnion('type', [zTabArtifactContent, zTabArtifactError]);
export type TabArtifactServerMessage = z.infer<typeof zTabArtifactServerMessage>;

/** The additional data of an answer's content. */
export const artifactAad = (requestId: string): string => `artifact:${requestId}`;
/** The additional data of an answer's key wrapped for `holderId` (HPKE `info` `crewdeck/v1/session-key`). */
export const artifactWrapAad = (requestId: string, holderId: string): string => `artifact:${requestId}:${holderId}`;

// --- The plaintexts, by kind: the Runner's and GitHub's mapped to one shape.

/** A file at a version: its blob's SHA, its content as UTF-8, or base64 with `binary: true`. */
export const zArtifactFile = z.strictObject({ path: z.string().min(1), sha: z.string().min(1), content: z.string(), binary: z.literal(true).optional() });
export type ArtifactFile = z.infer<typeof zArtifactFile>;

const zActor = z.strictObject({ login: z.string() }).nullable();

/** A comment, as `gh … view --json comments` prints it, its author `null` when unknown. */
export const zArtifactComment = z.strictObject({ author: zActor, body: z.string(), createdAt: z.string().nullable() });
export type ArtifactComment = z.infer<typeof zArtifactComment>;

/** A Ticket with its comments, in `gh issue view --json number,title,body,state,stateReason,labels,milestone,comments,blockedBy,parent`'s shape. */
export const zArtifactTicket = z.strictObject({
  number: z.int().positive(),
  title: z.string(),
  body: z.string(),
  state: z.enum(['OPEN', 'CLOSED']),
  /** `COMPLETED`, `NOT_PLANNED`…, `""` for an open Ticket. */
  stateReason: z.string(),
  labels: z.array(z.strictObject({ name: z.string() })),
  /** Its `number` `null` for a Local jalon `milestones.yml` does not hold (a title typed in the Ticket's file). */
  milestone: z.strictObject({ number: z.int().positive().nullable(), title: z.string(), description: z.string(), dueOn: z.string().nullable() }).nullable(),
  comments: z.array(zArtifactComment),
  blockedBy: z.array(z.int().positive()),
  parent: z.int().positive().nullable(),
});
export type ArtifactTicket = z.infer<typeof zArtifactTicket>;

/** A review of a change, as `gh pr view --json reviews` prints it. */
export const zArtifactReview = z.strictObject({
  author: zActor,
  /** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`… */
  state: z.string(),
  body: z.string(),
  submittedAt: z.string().nullable(),
  commit: z.strictObject({ oid: z.string() }).nullable(),
});
export type ArtifactReview = z.infer<typeof zArtifactReview>;

/** A change of code with its reviews and comments, in `gh pr view --json number,title,body,state,headRefName,headRefOid,baseRefName,reviews,comments`'s shape. */
export const zArtifactChange = z.strictObject({
  number: z.int().positive(),
  title: z.string(),
  body: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  headRefName: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  reviews: z.array(zArtifactReview),
  comments: z.array(zArtifactComment),
});
export type ArtifactChange = z.infer<typeof zArtifactChange>;

/** A unified diff of `head` against its merge base with `base` (`git diff base...head`). */
export const zArtifactDiff = z.strictObject({ base: z.string().min(1), head: z.string().min(1), patch: z.string() });
export type ArtifactDiff = z.infer<typeof zArtifactDiff>;

/** One chunk of a Commande's output, as the Runner logged it. */
export const zArtifactOutputChunk = z.strictObject({ seq: z.int().positive(), at: zInstant, stream: z.enum(['stdout', 'stderr']), text: z.string() });

/** A Commande's run, its logged output replayed. */
export const zArtifactCommandOutput = z.strictObject({ chunks: z.array(zArtifactOutputChunk) });
export type ArtifactCommandOutput = z.infer<typeof zArtifactCommandOutput>;

/** The plaintext of each kind. */
export const zArtifactPlaintexts = {
  file: zArtifactFile,
  ticket: zArtifactTicket,
  change: zArtifactChange,
  diff: zArtifactDiff,
  'command-output': zArtifactCommandOutput,
} as const satisfies Record<ArtifactKind, z.ZodType>;

export interface ArtifactPlaintexts {
  file: ArtifactFile;
  ticket: ArtifactTicket;
  change: ArtifactChange;
  diff: ArtifactDiff;
  'command-output': ArtifactCommandOutput;
}
export type ArtifactPlaintextOf<K extends ArtifactKind> = ArtifactPlaintexts[K];
