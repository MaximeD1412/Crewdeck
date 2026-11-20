import {
  type AgentSession,
  type EngineId,
  type RoleId,
  type SessionError,
  type SessionInterruptedReason,
  type SessionStart,
  type SessionStep,
  type StepId,
  CATALOGUE,
  zSealedItem,
  zSessionMcpServer,
  zSessionStepInput,
} from '@crewdeck/contracts';
import { z } from 'zod';
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
  titleSealed: true,
  titleAad: true,
  branch: true,
  base: true,
  permissionMode: true,
  state: true,
  interruptedReason: true,
  outcome: true,
  error: true,
  stepRunId: true,
  stepKind: true,
  stepSkill: true,
  stepContractId: true,
  stepInputs: true,
  mcpServers: true,
  engineSessionId: true,
  startedAt: true,
  endedAt: true,
  lastSeq: true,
  // The Projet's worktree Commandes, sealed as stored: `session.start` carries them, the view never (RUNNER-20).
  // Its code's Source (SOURCE-1) gives the origin `session.start` names, read as it is when sent (SOURCE-7 may move it).
  project: {
    select: {
      owner: true,
      name: true,
      settings: { select: { worktreeCommands: true } },
      artifactSources: { where: { group: 'code' }, select: { source: true } },
    },
  },
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
  titleSealed: row.titleSealed === null ? null : { ...zSealedItem.parse(row.titleSealed), aad: row.titleAad ?? '' },
  state: row.state,
  interruptedReason: row.interruptedReason === null ? null : spelled<SessionInterruptedReason>(row.interruptedReason),
  outcome: row.outcome,
  error: row.error === null ? null : spelled<SessionError>(row.error),
  stepRunId: row.stepRunId,
  branch: row.branch,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
});

/**
 * The origin a Session of `row`'s Projet clones: its repository on GitHub,
 * or its folder when its code is Local (SOURCE-2), whose path only the
 * Runner knows.
 */
export const originOf = (project: SessionRow['project']): SessionStart['origin'] => {
  if (project.artifactSources[0]?.source === 'local') return { kind: 'local' };
  const { owner, name } = githubNamesOf(project);
  return { kind: 'github', owner, name };
};

/** The `session.start` of the Session `row`: its origin (`originOf`), its title readable or `null` (a Local Projet's, sealed), its Projet's worktree Commandes sealed as stored, `null` when the Pilote set neither. */
export const startMessageOf = (row: SessionRow): Omit<SessionStart, 'id' | 'at'> => ({
  type: 'session.start',
  sessionId: row.id,
  projectId: row.projectId,
  origin: originOf(row.project),
  branch: row.branch,
  base: row.base,
  engine: spelled<EngineId>(row.engine),
  model: row.model,
  role: row.role,
  permissionMode: row.permissionMode as SessionStart['permissionMode'],
  ...(stepOf(row) ? { step: stepOf(row) } : {}),
  title: row.title,
  worktreeCommands: row.project.settings?.worktreeCommands ? zSealedItem.parse(row.project.settings.worktreeCommands) : null,
  mcpServers: z.array(zSessionMcpServer).parse(row.mcpServers),
});

/**
 * The Étape of the Session `row`, as `session.start` carries it: its StepRun
 * and kind, its Skill (the kind's own when the row predates them), its
 * Contrat and its Entrées; none without a StepRun.
 */
const stepOf = (row: SessionRow): SessionStep | undefined =>
  row.stepRunId === null || row.stepKind === null
    ? undefined
    : {
        stepRunId: row.stepRunId,
        stepKind: row.stepKind as StepId,
        skill: row.stepSkill ?? CATALOGUE[row.stepKind as StepId].skill ?? row.stepKind,
        contractId: row.stepContractId,
        inputs: z.array(zSessionStepInput).parse(row.stepInputs ?? []),
      };
