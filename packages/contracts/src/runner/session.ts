import { z } from 'zod';
import { zStepId } from '../contrats/define.js';
import { zSha } from '../github/index.js';
import { zSealedItem } from '../keys/sealed.js';
import { zArtifactType } from '../process/artifact-types.js';
import { zProcessId } from '../process/definition.js';
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

/** A Skill's id: the folder of `apps/runner/skills/` the Runner mounts (`code`, `product-design`). */
export const zSkillId = z.string().min(1).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/**
 * An Artefact an Entrée of the StepRun took, by reference only (ADR 0003,
 * ADR 0011): its `id` (an Idée's or a Ticket's id, a document's path, a
 * change's number), its `number` when the id is one (a Ticket, a change of
 * code), its SHA when it lives in git. The Skill reads its content through
 * the Miroir; `ref: null` is the Entrée « absente », which the Skill and the
 * Contrat say the meaning of.
 */
export const zSessionStepInput = z.object({
  portId: zProcessId,
  type: zArtifactType,
  ref: z.object({ id: z.string().min(1).max(200), number: z.int().positive().optional(), sha: zSha.optional() }).nullable(),
});
export type SessionStepInput = z.infer<typeof zSessionStepInput>;

/** How many references the Entrées of one StepRun carry at most. */
export const SESSION_STEP_INPUTS_MAX = 200;

/** How many open Idées the context of an analysis carries at most, the latest first. */
export const SESSION_STEP_OPEN_IDEAS_MAX = 100;

/**
 * An Idée of the context of an `idea-analysis` Session (IDEE-2), as the
 * server stores it: its id, its number, its text and its last analysis
 * sealed under the vault key (`ideaItemAad`), which the Runner opens to write
 * `.crewdeck/context.json`; the server never reads them.
 */
export const zSessionStepIdea = z.object({
  id: zId,
  number: z.int().positive(),
  text: zSealedItem,
  analysis: zSealedItem.nullable(),
});
export type SessionStepIdea = z.infer<typeof zSessionStepIdea>;

/**
 * What an `idea-analysis` Session reads besides the Miroir (IDEE-2): the Idée
 * it analyses, and the other open Idées of the Pilote (its duplicates may be
 * among them). The Projets and their open Tickets come from the Runner's
 * Miroir, whatever their Source.
 */
export const zSessionStepIdeaContext = z.object({
  idea: zSessionStepIdea,
  open: z.array(zSessionStepIdea).max(SESSION_STEP_OPEN_IDEAS_MAX),
});
export type SessionStepIdeaContext = z.infer<typeof zSessionStepIdeaContext>;

/**
 * The Étape a Session runs (RUNNER-12): its StepRun and kind, the Skill the
 * Runner mounts (the Étape's `skill` Outil, else its kind's default), the id
 * of its Contrat checked at the Session's end (`null`: none, the Session's
 * end is the Étape's), and its Entrées as references. The Runner builds the
 * first message from its embedded template; `crewdeck-runner etape start`
 * prints the rest to the Skill. A Session without one starts with no
 * message (the Pilote writes first).
 */
export const zSessionStep = z.object({
  stepRunId: zId,
  stepKind: zStepId,
  skill: zSkillId,
  contractId: z.string().min(1).max(60).nullable(),
  inputs: z.array(zSessionStepInput).max(SESSION_STEP_INPUTS_MAX),
  /** The Idées an `idea-analysis` Session reads, for that kind only. */
  ideas: zSessionStepIdeaContext.optional(),
});
export type SessionStep = z.infer<typeof zSessionStep>;

/**
 * A Session's title: readable for a GitHub Projet (a Ticket's or a
 * Conception's title, ADR 0003), `null` for a Local one, whose titles reach
 * the server sealed (ADR 0012).
 */
export const zSessionTitle = z.string().min(1).max(300);

/**
 * The Projet's worktree Commandes « Préparer le worktree » and « Nettoyer le
 * worktree » (RUNNER-20, ADR 0011, ADR 0013), sealed as `ProjectSettings`
 * stores them (plaintext `zWorktreeCommands`, additional data
 * `settings:<projectId>`): the server never opens them, the Runner does and
 * runs them around each worktree it makes. `null` when the Pilote set
 * neither.
 */
export const zWorktreeCommandsSealed = zSealedItem.nullable();

/**
 * A Serveur MCP the Session's Étape holds as an Outil (`{ kind: 'mcp', name }`),
 * by its name as the definition spells it; RUNNER-17 mounts it, by that name.
 */
export const zSessionMcpServer = z.string().trim().min(1).max(60);

/** The most Serveurs MCP one Session names: an Étape's Outils are 10 at most. */
export const SESSION_MCP_SERVERS_MAX = 10;

/**
 * Server → Runner: start the Session `sessionId` (RUNNER-9) in a worktree of
 * `branch` (from `origin/<branch>` when it exists, else from `origin/<base>`),
 * or, when `origin`, `branch` and `base` are all `null`, in a scratch
 * directory of its own (`~/.crewdeck/scratch/<sessionId>/`, IDEE-2: an Étape
 * that reads no code, of a Projet or of none, `projectId` then `null`);
 * with the Moteur `engine` on `model`, as the Rôle `role`, the worktree
 * prepared by `worktreeCommands` before the Moteur starts and cleaned by them
 * before it is removed, the Serveurs MCP of its Étape named in `mcpServers`
 * (`[]` when none). The Runner reports it with `session.state`; a Session
 * it already knows is not started twice.
 */
export const zSessionStart = runnerMessage('session.start', {
  sessionId: zId,
  projectId: zId.nullable(),
  // A pointer to the union `contracts.Origin` in Go, nil for a scratch Session.
  origin: zOrigin.nullable().meta({ goJSONSchema: { type: '*Origin' } }),
  branch: zGitBranch.nullable(),
  base: zGitBranch.nullable(),
  // `ENGINE_IDS` without `zEngineId`'s `meta` id, which the Go types of `capabilities` already declare.
  engine: z.enum(ENGINE_IDS),
  model: z.string().min(1).max(200),
  role: zSessionRole,
  permissionMode: zSessionPermissionMode,
  step: zSessionStep.optional(),
  title: zSessionTitle.nullable(),
  worktreeCommands: zWorktreeCommandsSealed,
  mcpServers: z.array(zSessionMcpServer).max(SESSION_MCP_SERVERS_MAX),
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
 * Why an `ended` Session ended in `error`: its worktree could not be made or
 * its preparation failed (`setup-failed`, « Préparer le worktree » that exits
 * non-zero, times out, or does not open), another live Session has its branch (`branch-busy`), its
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

/** What a Session's request asks: an answer to a question, or a permission. */
export const SESSION_REQUEST_KINDS = ['question', 'permission'] as const;
export const zSessionRequestKind = z.enum(SESSION_REQUEST_KINDS);
export type SessionRequestKind = z.infer<typeof zSessionRequestKind>;

/**
 * Runner → server: the agent of the Session waits for the Pilote's answer to
 * the request `requestId` (SESSION-3), the event `seq` of its log. Never the
 * question nor the command: the page reads them through the relay.
 */
export const zSessionWaiting = runnerMessage('session.waiting', {
  sessionId: zId,
  requestId: z.string().min(1).max(200),
  kind: zSessionRequestKind,
  seq: z.int().positive(),
});
export type SessionWaiting = z.infer<typeof zSessionWaiting>;

/** Runner → server: the request `requestId` was answered, from whichever tab. */
export const zSessionAnswered = runnerMessage('session.answered', { sessionId: zId, requestId: z.string().min(1).max(200) });
export type SessionAnswered = z.infer<typeof zSessionAnswered>;

/** A Session the Runner knows, in its `hello`: `alive` while its Moteur still runs (never after a restart of the Runner). */
export const zHelloSession = z.object({ sessionId: zId, alive: z.boolean() });
export type HelloSession = z.infer<typeof zHelloSession>;

/** How many Sessions one `hello` may report: the Runner reports those not `ended`. */
export const HELLO_SESSIONS_MAX = 1000;
