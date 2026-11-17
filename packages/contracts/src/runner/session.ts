import { z } from 'zod';
import { zStepId } from '../contrats/define.js';
import { AGENT_ROLES, zId } from '../values.js';
import { ENGINE_IDS } from './engines.js';
import { runnerMessage } from './envelope.js';
import { zOrigin } from './origin.js';

/**
 * A git branch the Runner checks out: what `git check-ref-format --branch`
 * accepts, narrowed to the characters a path of the Runner may hold (the
 * worktree is named after it, « / » replaced by « __ »). The pattern is what
 * Go's regexp can read (no lookahead); the rest is `isGitBranch`, which the
 * Runner checks again (`session.validBranch`).
 */
export const GIT_BRANCH_CHARS = /^[A-Za-z0-9._/-]+$/;
export const isGitBranch = (branch: string): boolean =>
  GIT_BRANCH_CHARS.test(branch) &&
  !branch.startsWith('-') &&
  !branch.startsWith('/') &&
  !branch.endsWith('/') &&
  !branch.endsWith('.lock') &&
  !branch.endsWith('.') &&
  !branch.includes('..') &&
  !branch.includes('//') &&
  !branch.includes('/.') &&
  !branch.includes('__') &&
  !branch.startsWith('.');
export const zGitBranch = z.string().min(1).max(200).regex(GIT_BRANCH_CHARS).refine(isGitBranch);

/** A Rôle's id as the Runner receives it, one string (one of the four defaults, or `r-` and 8 characters, PARAM-2). */
export const zSessionRole = z.string().regex(new RegExp(`^(?:${AGENT_ROLES.join('|')}|r-[a-z0-9]{8})$`));

/** How the Moteur asks before acting (ADR 0004): `bypass` for the Étapes that work in their worktree (Code, Review), `auto` for the others. */
export const SESSION_PERMISSION_MODES = ['auto', 'bypass'] as const;
export const zSessionPermissionMode = z.enum(SESSION_PERMISSION_MODES);
export type SessionPermissionMode = z.infer<typeof zSessionPermissionMode>;

/**
 * The Étape a Session runs: the Runner builds its first message from its
 * embedded template for the StepRun (RUNNER-12 completes it). A Session
 * without one starts with no message (the Pilote writes first).
 */
export const zSessionStep = z.object({ stepRunId: zId, stepKind: zStepId });
export type SessionStep = z.infer<typeof zSessionStep>;

/** A Session's title: readable for a GitHub Projet (a Ticket's or a Conception's title, ADR 0003). */
export const zSessionTitle = z.string().min(1).max(300);

/**
 * Server → Runner: start the Session `sessionId` (RUNNER-9) in a worktree of
 * `branch` (from `origin/<branch>` when it exists, else from `origin/<base>`),
 * with the Moteur `engine` on `model`, as the Rôle `role`. The Runner reports
 * it with `session.state`; a Session it already knows is not started twice.
 */
export const zSessionStart = runnerMessage('session.start', {
  sessionId: zId,
  projectId: zId,
  origin: zOrigin,
  branch: zGitBranch,
  base: zGitBranch,
  // `ENGINE_IDS` without `zEngineId`'s `meta` id, which the Go types of `capabilities` already declare.
  engine: z.enum(ENGINE_IDS),
  model: z.string().min(1).max(200),
  role: zSessionRole,
  permissionMode: zSessionPermissionMode,
  step: zSessionStep.optional(),
  title: zSessionTitle,
});
export type SessionStart = z.infer<typeof zSessionStart>;

/** Server → Runner: stop the Session's Moteur; the Session keeps its worktree and its Moteur's id, for a resume. */
export const zSessionStop = runnerMessage('session.stop', { sessionId: zId });
export type SessionStop = z.infer<typeof zSessionStop>;

/** Server → Runner: start again the stopped or interrupted Session on the same Moteur session (its kept `engineSessionId`). */
export const zSessionResume = runnerMessage('session.resume', { sessionId: zId });
export type SessionResume = z.infer<typeof zSessionResume>;

/**
 * A Session's state: `starting` while its clone and worktree are made,
 * `active` while the agent works, `waiting` while it waits for the Pilote (a
 * question, a permission, its next message), `stopped` by the Pilote,
 * `interrupted` by the Runner going away, `ended` for good.
 */
export const SESSION_STATES = ['starting', 'active', 'waiting', 'stopped', 'interrupted', 'ended'] as const;
export const zSessionState = z.enum(SESSION_STATES);
export type SessionState = z.infer<typeof zSessionState>;

/** The states of a Session whose Moteur runs, or is about to. */
export const LIVE_SESSION_STATES = ['starting', 'active', 'waiting'] as const satisfies readonly SessionState[];

/** The states a Session is resumed from. */
export const RESUMABLE_SESSION_STATES = ['stopped', 'interrupted'] as const satisfies readonly SessionState[];

/** How an `ended` Session ended. */
export const SESSION_OUTCOMES = ['ok', 'error'] as const;
export const zSessionOutcome = z.enum(SESSION_OUTCOMES);
export type SessionOutcome = z.infer<typeof zSessionOutcome>;

/**
 * Why an `ended` Session ended in `error`: its worktree's preparation failed
 * (`setup-failed`), another live Session has its branch (`branch-busy`), its
 * Moteur failed or could not start (`engine-failed`), its clone or fetch
 * failed (`clone-failed`). A code, never the error's text.
 */
export const SESSION_ERRORS = ['setup-failed', 'branch-busy', 'engine-failed', 'clone-failed'] as const;
export const zSessionError = z.enum(SESSION_ERRORS);
export type SessionError = z.infer<typeof zSessionError>;

/**
 * Runner → server: the Session's new state, with how it ended once `ended`,
 * and the Moteur's own id of it once the Moteur gave it (what a resume
 * takes). States only, never the Session's content (SESSION-1 relays it).
 */
export const zSessionStateMessage = runnerMessage('session.state', {
  sessionId: zId,
  state: zSessionState,
  outcome: zSessionOutcome.optional(),
  error: zSessionError.optional(),
  engineSessionId: z.string().min(1).max(200).optional(),
});
export type SessionStateMessage = z.infer<typeof zSessionStateMessage>;

/** A Session the Runner knows, in its `hello`: `alive` while its Moteur still runs (never after a restart of the Runner). */
export const zHelloSession = z.object({ sessionId: zId, alive: z.boolean() });
export type HelloSession = z.infer<typeof zHelloSession>;

/** How many Sessions one `hello` may report: the Runner reports those not `ended`. */
export const HELLO_SESSIONS_MAX = 1000;
