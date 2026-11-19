import { z } from 'zod';
import { zBytes } from '../keys/pairing.js';
import { zSealedItem } from '../keys/sealed.js';
import { zProcessId, zProcessSealedPayload } from '../process/definition.js';
import { zId, zInstant } from '../values.js';
import { runnerMessage } from './envelope.js';
import { zOrigin } from './origin.js';
import { SESSION_KEY_WRAPS_MAX, zNonce, zRelaySeq, zSessionKeyWrap } from './relay.js';
import { zGitBranch } from './session.js';

/**
 * The Commandes on the Runner (RUNNER-18, ADR 0013, ADR 0011 « What the
 * server reads of a Process », `docs/security/e2e.md` « Commandes »).
 *
 * The server asks a run with `command.run`: the ids, the Projet's origin,
 * the Ticket it judges, and the version's sealed part, which only the Runner
 * opens (additional data `process:<projectId>`, the message's own
 * `projectId`). The text and the place it runs are the opened ones, never a
 * field of the message: a server that cannot open the sealed part cannot
 * make the Runner run anything (risk SEC-11).
 *
 * - server → Runner: `command.run`, `command.stop`, `command.replay`;
 * - Runner → server: `command.started`, `command.verdict` (figures only),
 *   `command.keys` and `command.output` (with the `tabId` of a replay,
 *   without one for the live chunks);
 * - tab → server: `command.open` (from `fromSeq`), `command.close`;
 * - server → tab: `command.keys`, `command.output` (without `tabId`),
 *   `command.error`.
 *
 * The output is relayed as a Session's: a key per run, wrapped by the Runner
 * for each Appareil (HPKE `info` `SESSION_KEY_INFO`, additional data
 * `"command:<runId>:<holderId>"`), each chunk sealed under it with the
 * additional data `"command:<runId>:<seq>"`. The server forwards and keeps
 * none of it.
 */

/** The plaintext of a version's sealed part, as the Runner opens it: `zProcessSealedPayload`. */
export const zSealedCommands = zProcessSealedPayload;

/** How long a Commande runs before its process group is killed and its run fails as `timeout`. */
export const COMMAND_TIMEOUT_MINUTES = 30;

/**
 * How long a Commande with a health address has to answer 2xx to a `GET`
 * (polled every second) before its group is killed and its run fails as
 * `health-timeout`; the 30 min of COMMAND_TIMEOUT_MINUTES do not apply to it.
 */
export const COMMAND_HEALTH_SECONDS = 120;

/** How long the Runner keeps a run's output, `~/.crewdeck/commands/<runId>.log`. */
export const COMMAND_LOG_DAYS = 30;

/** The most bytes of output one chunk holds: what one read of a stream gave. */
export const COMMAND_CHUNK_BYTES_MAX = 16 * 1024;

/** The longest ciphertext of a chunk: its text JSON-escaped (6 bytes a control character at most), its stream and instant. */
export const COMMAND_OUTPUT_CIPHERTEXT_MAX = 128 * 1024;

/** A commit, as git names it in full (SHA-1, or SHA-256). */
export const zGitSha = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);

/**
 * What the run judges: its Étape, and the Ticket's number, branch and the
 * SHA under judgement, each null outside a Ticket (the « Livraison » of the
 * integration branch). `worktree` runs at `branch` and `sha`; `project` at
 * `sha`, else at the head of the integration branch.
 */
export const zCommandRunRef = z.object({
  stepId: zProcessId,
  ticket: z.int().positive().nullable(),
  branch: zGitBranch.nullable(),
  sha: zGitSha.nullable(),
});
export type CommandRunRef = z.infer<typeof zCommandRunRef>;

/**
 * Server → Runner: run the Commande `commandId` of the sealed part for the
 * Projet. The Runner answers `command.started` once its process started,
 * then `command.verdict`; a second run of the same Commande while one runs
 * gets `busy`.
 */
export const zCommandRun = runnerMessage('command.run', {
  runId: zId,
  projectId: zId,
  commandId: zProcessId,
  sealed: zSealedItem,
  origin: zOrigin,
  integrationBranch: zGitBranch,
  ref: zCommandRunRef,
});
export type CommandRun = z.infer<typeof zCommandRun>;

/** Server → Runner: stop the run: its process group gets SIGTERM, SIGKILL after 10 s; its verdict is `stopped`. */
export const zCommandStop = runnerMessage('command.stop', { runId: zId });
export type CommandStop = z.infer<typeof zCommandStop>;

/** Runner → server: the run's process started. */
export const zCommandStarted = runnerMessage('command.started', { runId: zId });
export type CommandStarted = z.infer<typeof zCommandStarted>;

/**
 * How a run ended: its process exited (`exited`, its `exitCode`), it was
 * killed after the timeout (`timeout`) or on `command.stop` (`stopped`), its
 * health address answered 2xx (`healthy`: its `exitCode` 0 when its process
 * had exited, null when it runs on as a service of the Runner) or did not
 * within COMMAND_HEALTH_SECONDS (`health-timeout`, the group killed), or
 * it never started: the same Commande already running (`busy`), a sealed part
 * that does not open for this Projet or holds no such Commande
 * (`sealed-invalid`), its place not available (`place-unavailable`), its
 * shell that could not start (`spawn-failed`).
 */
export const COMMAND_RUN_REASONS = ['exited', 'healthy', 'timeout', 'health-timeout', 'stopped', 'busy', 'sealed-invalid', 'place-unavailable', 'spawn-failed'] as const;
export const zCommandRunReason = z.enum(COMMAND_RUN_REASONS);
export type CommandRunReason = z.infer<typeof zCommandRunReason>;

/** Runner → server: the run's verdict, figures only (ADR 0003): `passed` when it exited with 0, or when it is `healthy`. */
export const zCommandVerdict = runnerMessage('command.verdict', {
  runId: zId,
  passed: z.boolean(),
  exitCode: z.int().min(0).max(255).nullable(),
  reason: zCommandRunReason,
  durationMs: z.int().nonnegative(),
});
export type CommandVerdict = z.infer<typeof zCommandVerdict>;

const keysShape = { runId: zId, wraps: z.array(zSessionKeyWrap).min(1).max(SESSION_KEY_WRAPS_MAX) };
const outputShape = { runId: zId, seq: zRelaySeq, nonce: zNonce, ciphertext: zBytes(16, COMMAND_OUTPUT_CIPHERTEXT_MAX) };

/** Server → Runner: send the tab `tabId` the run's key, then its logged chunks from `fromSeq` (included). */
export const zCommandReplay = runnerMessage('command.replay', { runId: zId, tabId: zId, fromSeq: zRelaySeq });
export type CommandReplay = z.infer<typeof zCommandReplay>;

/** Runner → server: the run's key for its holders, for the tab `tabId` of a replay, else for every tab of the run. */
export const zCommandKeys = runnerMessage('command.keys', { ...keysShape, tabId: zId.optional() });
export type CommandKeys = z.infer<typeof zCommandKeys>;

/** Runner → server: one chunk of the run's output, for the tab `tabId` of a replay, else live for every tab of the run. */
export const zCommandOutput = runnerMessage('command.output', { ...outputShape, tabId: zId.optional() });
export type CommandOutput = z.infer<typeof zCommandOutput>;

/** The plaintext of a `command.output`: what one read of one stream gave, at that instant. */
export const zCommandOutputChunk = z.object({ stream: z.enum(['stdout', 'stderr']), text: z.string(), at: zInstant });
export type CommandOutputChunk = z.infer<typeof zCommandOutputChunk>;

/** The additional data of a chunk of the run `runId`. */
export const commandOutputAad = (runId: string, seq: number): string => `command:${runId}:${seq}`;
/** The additional data of the run's key wrapped for `holderId`. */
export const commandWrapAad = (runId: string, holderId: string): string => `command:${runId}:${holderId}`;

/** Tab → server: follow the run's output, from `fromSeq` (1 for all of it). */
export const zTabCommandOpen = z.object({ type: z.literal('command.open'), runId: zId, fromSeq: zRelaySeq });
/** Tab → server: stop following the run's output. */
export const zTabCommandClose = z.object({ type: z.literal('command.close'), runId: zId });

/** Server → tab: the run's key, wrapped for each holder. */
export const zTabCommandKeys = z.object({ type: z.literal('command.keys'), ...keysShape });
/** Server → tab: one chunk of the run's output. */
export const zTabCommandOutput = z.object({ type: z.literal('command.output'), ...outputShape });

/** Why the server refuses a run's open: not the Pilote's (or no such run), or its Runner is offline. */
export const COMMAND_RELAY_ERRORS = ['command.not-found', 'command.runner-offline'] as const;
export const zCommandRelayError = z.enum(COMMAND_RELAY_ERRORS);
export type CommandRelayError = z.infer<typeof zCommandRelayError>;

/** Server → tab: the open of `runId` failed. An offline Runner keeps the open: its replay comes once it is back. */
export const zTabCommandError = z.object({ type: z.literal('command.error'), runId: zId, code: zCommandRelayError });

export const zTabCommandClientMessage = z.discriminatedUnion('type', [zTabCommandOpen, zTabCommandClose]);
export type TabCommandClientMessage = z.infer<typeof zTabCommandClientMessage>;
export const zTabCommandServerMessage = z.discriminatedUnion('type', [zTabCommandKeys, zTabCommandOutput, zTabCommandError]);
export type TabCommandServerMessage = z.infer<typeof zTabCommandServerMessage>;
