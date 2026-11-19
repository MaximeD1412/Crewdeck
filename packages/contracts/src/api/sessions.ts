import { z } from 'zod';
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
 * A Session (RUNNER-9): one conversation of an agent in one Rôle, on the
 * Runner, with one Moteur, on its `branch`. What the server may read (ADR
 * 0003): its state and how it ended, its readable title (a GitHub
 * Projet's) or `titleSealed` (a Local one's, which the page opens, ADR
 * 0012), one of the two; never its content, which stays in the Runner's log
 * (SESSION-1 relays it). `GET
 * /api/sessions`, the `sessions` slice of `GET /api/state` and the payload
 * of `agent-session.upserted`.
 */
export const zAgentSession = z.object({
  id: zId,
  projectId: zId,
  role: zRoleId,
  engine: zEngineId,
  model: z.string().min(1),
  title: zSessionTitle.nullable(),
  titleSealed: zSealedItem.nullable(),
  state: zSessionState,
  interruptedReason: zSessionInterruptedReason.nullable(),
  outcome: zSessionOutcome.nullable(),
  error: zSessionError.nullable(),
  stepRunId: zId.nullable(),
  branch: zGitBranch,
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
