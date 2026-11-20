import { z } from 'zod';
import type { InstallationPermissions } from '../github/index.js';
import { zSealedItem } from '../keys/sealed.js';
import { zEngineId } from '../runner/engines.js';
import { zGitBranch, zSessionError, zSessionOutcome, zSessionState, zSessionTitle } from '../runner/session.js';
import { zCursorPage, zId, zInstant } from '../values.js';
import { withSeq } from './commands.js';
import { zRoleId } from './roles.js';

/** Why a Session is `interrupted` (US-60): its Runner went offline, or restarted. */
export const SESSION_INTERRUPTED_REASONS = ['runner-offline', 'runner-restarted'] as const;
export const zSessionInterruptedReason = z.enum(SESSION_INTERRUPTED_REASONS);
export type SessionInterruptedReason = z.infer<typeof zSessionInterruptedReason>;

/**
 * The sealed title of a Session, a copy of the title of the artifact it works
 * on when that artifact is Local (ADR 0012): its item, and the additional data
 * that artifact sealed it under, which the page opens it with and a rotation
 * rewraps it with (`agent-session.title`).
 */
export const zSealedSessionTitle = zSealedItem.extend({ aad: z.string().min(1).max(200) });
export type SealedSessionTitle = z.infer<typeof zSealedSessionTitle>;

/**
 * A Session (RUNNER-9): one conversation of an agent in one Rôle, on the
 * Runner, with one Moteur, on its `branch` (`null` for a Session in a
 * scratch directory, of a Projet or of none: `projectId` then `null`, IDEE-2). What the server may read (ADR
 * 0003): its state and how it ended, its readable title (that of an artifact
 * on GitHub) or `titleSealed` (that of a Local one, which the page opens, ADR
 * 0012), one of the two, whatever the Source of the code it clones; never its
 * content, which stays in the Runner's log (SESSION-1 relays it). `GET
 * /api/sessions`, the `sessions` slice of `GET /api/state` and the payload
 * of `agent-session.upserted`.
 */
export const zAgentSession = z.object({
  id: zId,
  projectId: zId.nullable(),
  role: zRoleId,
  engine: zEngineId,
  model: z.string().min(1),
  title: zSessionTitle.nullable(),
  titleSealed: zSealedSessionTitle.nullable(),
  state: zSessionState,
  interruptedReason: zSessionInterruptedReason.nullable(),
  outcome: zSessionOutcome.nullable(),
  error: zSessionError.nullable(),
  stepRunId: zId.nullable(),
  branch: zGitBranch.nullable(),
  startedAt: zInstant,
  endedAt: zInstant.nullable(),
});
export type AgentSession = z.infer<typeof zAgentSession>;

/** `GET /api/sessions?projectId=&cursor=`: a page of 50, newest first. */
export const zAgentSessionListQuery = z.object({
  projectId: zId.optional(),
  cursor: z.string().min(1).optional(),
});
export type AgentSessionListQuery = z.infer<typeof zAgentSessionListQuery>;

export const zAgentSessionList = zCursorPage(zAgentSession);
export type AgentSessionList = z.infer<typeof zAgentSessionList>;

/** `POST /api/sessions/:id/stop` and `/resume`: the `seq` the page read the Session at. */
export const zSessionAction = withSeq(z.object({}));
export type SessionAction = z.infer<typeof zSessionAction>;

/**
 * What a Session's GitHub token may do (ADR 0002, risk SEC-6): the four
 * permissions an agent writes with, on the Session's repository only, 1 h.
 * Never the Pilote's token, never a broader one.
 */
export const SESSION_TOKEN_PERMISSIONS = {
  contents: 'write',
  issues: 'write',
  pull_requests: 'write',
  workflows: 'write',
} as const satisfies InstallationPermissions;

/**
 * `POST /api/runner/sessions/:id/github-token` (RUNNER-10), with the Runner's
 * token: the Session's installation token and when it expires. The Runner
 * keeps it in memory only and renews it before `expiresAt`; the server never
 * stores nor logs it.
 */
export const zSessionGithubToken = z.object({
  token: z.string().min(1),
  expiresAt: zInstant,
});
export type SessionGithubToken = z.infer<typeof zSessionGithubToken>;
