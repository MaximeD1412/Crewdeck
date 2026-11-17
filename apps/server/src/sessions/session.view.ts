import type { AgentSession, EngineId, RoleId, SessionError, SessionInterruptedReason, SessionStart, StepId } from '@crewdeck/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { githubNamesOf } from '../projects/project.view.js';

/** What a Session's view, and the `session.start` it is sent with, read of its row. */
export const SESSION_ROW = {
  id: true,
  projectId: true,
  role: true,
  engine: true,
  model: true,
  title: true,
  branch: true,
  base: true,
  permissionMode: true,
  state: true,
  interruptedReason: true,
  outcome: true,
  error: true,
  stepRunId: true,
  stepKind: true,
  engineSessionId: true,
  startedAt: true,
  endedAt: true,
  lastSeq: true,
  project: { select: { owner: true, name: true } },
} as const satisfies Prisma.AgentSessionSelect;

export type SessionRow = Prisma.AgentSessionGetPayload<{ select: typeof SESSION_ROW }>;

/** The codes as the contracts spell them (`setup-failed`), Prisma's enums keeping `setup_failed`. */
const spelled = <T extends string>(value: string): T => value.replaceAll('_', '-') as T;

/** A code as Prisma's enum keeps it (`setup_failed`). */
export const stored = <T extends string>(value: string): T => value.replaceAll('-', '_') as T;

export const toAgentSession = (row: SessionRow): AgentSession => ({
  id: row.id,
  projectId: row.projectId,
  role: row.role as RoleId,
  engine: spelled<EngineId>(row.engine),
  model: row.model,
  title: row.title,
  state: row.state,
  interruptedReason: row.interruptedReason === null ? null : spelled<SessionInterruptedReason>(row.interruptedReason),
  outcome: row.outcome,
  error: row.error === null ? null : spelled<SessionError>(row.error),
  stepRunId: row.stepRunId,
  branch: row.branch,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
});

/** The `session.start` of the Session `row`: its origin the Projet's repository on GitHub (SOURCE-2 adds the Local one). */
export const startMessageOf = (row: SessionRow): Omit<SessionStart, 'id' | 'at'> => ({
  type: 'session.start',
  sessionId: row.id,
  projectId: row.projectId,
  origin: { kind: 'github', owner: githubNamesOf(row.project).owner, name: githubNamesOf(row.project).name },
  branch: row.branch,
  base: row.base,
  engine: spelled<EngineId>(row.engine),
  model: row.model,
  role: row.role,
  permissionMode: row.permissionMode as SessionStart['permissionMode'],
  ...(row.stepRunId !== null && row.stepKind !== null ? { step: { stepRunId: row.stepRunId, stepKind: row.stepKind as StepId } } : {}),
  title: row.title,
});
