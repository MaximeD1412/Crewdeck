import {
  type AgentSession,
  type EngineId,
  type RoleId,
  type SessionError,
  type SessionInterruptedReason,
  type SessionStart,
  type SessionStep,
  type SessionStepIdea,
  type SessionStepIdeaContext,
  type StepId,
  CATALOGUE,
  SESSION_STEP_OPEN_IDEAS_MAX,
  zId,
  zSealedItem,
  zSessionMcpServer,
  zSessionStepInput,
} from '@crewdeck/contracts';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { githubNamesOf } from '../projects/project.view.js';
import type { Tx } from '../realtime/transactions.js';
import { heldVaultVersion } from '../vault/sealed-write.js';

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
  stepIdeas: true,
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
export const originOf = (project: NonNullable<SessionRow['project']>): NonNullable<SessionStart['origin']> => {
  if (project.artifactSources[0]?.source === 'local') return { kind: 'local' };
  const { owner, name } = githubNamesOf(project);
  return { kind: 'github', owner, name };
};

/**
 * The `session.start` of the Session `row`: its origin (`originOf`), its
 * title readable or `null` (a Local Projet's, sealed), its Projet's worktree
 * Commandes sealed as stored, `null` when the Pilote set neither. A Session
 * without a branch runs in a scratch directory (IDEE-2): no origin, no base,
 * no worktree Commandes.
 */
export const startMessageOf = (row: SessionRow, ideas?: SessionStepIdeaContext): Omit<SessionStart, 'id' | 'at'> => ({
  type: 'session.start',
  sessionId: row.id,
  projectId: row.projectId,
  ...(row.branch === null || row.project === null
    ? { origin: null, branch: null, base: null, worktreeCommands: null }
    : {
        origin: originOf(row.project),
        branch: row.branch,
        base: row.base,
        worktreeCommands: row.project.settings?.worktreeCommands ? zSealedItem.parse(row.project.settings.worktreeCommands) : null,
      }),
  engine: spelled<EngineId>(row.engine),
  model: row.model,
  role: row.role,
  permissionMode: row.permissionMode as SessionStart['permissionMode'],
  ...(stepOf(row, ideas) ? { step: stepOf(row, ideas) } : {}),
  title: row.title,
  mcpServers: z.array(zSessionMcpServer).parse(row.mcpServers),
});

/**
 * The Étape of the Session `row`, as `session.start` carries it: its StepRun
 * and kind, its Skill (the kind's own when the row predates them), its
 * Contrat and its Entrées, and the Idées an `idea-analysis` one reads
 * (`ideas`, read by `stepIdeasOf`); none without a StepRun.
 */
const stepOf = (row: SessionRow, ideas: SessionStepIdeaContext | undefined): SessionStep | undefined =>
  row.stepRunId === null || row.stepKind === null
    ? undefined
    : {
        stepRunId: row.stepRunId,
        stepKind: row.stepKind as StepId,
        skill: row.stepSkill ?? CATALOGUE[row.stepKind as StepId].skill ?? row.stepKind,
        contractId: row.stepContractId,
        inputs: z.array(zSessionStepInput).parse(row.stepInputs ?? []),
        ...(ideas ? { ideas } : {}),
      };

/** What a Session's row keeps of the Idées it reads: their ids, never their texts. */
const zStepIdeasRow = z.object({ ideaId: zId, openIds: z.array(zId).max(SESSION_STEP_OPEN_IDEAS_MAX) });

/** The row's `stepIdeas` of the context an `idea-analysis` Session reads. */
export const stepIdeasRow = (ideas: SessionStepIdeaContext): Prisma.InputJsonValue => ({ ideaId: ideas.idea.id, openIds: ideas.open.map(({ id }) => id) });

/** What an Idée of a Session's context reads of its row. */
export const IDEA_CONTEXT_ROW = { id: true, number: true, text: true, analysis: true } as const satisfies Prisma.IdeaSelect;

export const toStepIdea = (row: { id: string; number: number; text: unknown; analysis: unknown }): SessionStepIdea => ({
  id: row.id,
  number: row.number,
  text: zSealedItem.parse(row.text),
  analysis: row.analysis === null ? null : zSealedItem.parse(row.analysis),
});

/**
 * The Idées the Session `row` reads, as they are stored when its start is
 * sent: their texts and analyses under their item keys of now, which a
 * rotation of the vault key replaced since the Session was created, with
 * the version they are wrapped under (E2E-4).
 * The open Idées deleted since are left out; none once its own Idée is.
 */
export const stepIdeasOf = async (tx: Tx, pilotId: string, row: SessionRow): Promise<SessionStepIdeaContext | undefined> => {
  if (row.stepIdeas === null) return undefined;
  const { ideaId, openIds } = zStepIdeasRow.parse(row.stepIdeas);
  // The version first, the Pilote's row held: the item keys read next are under it.
  const vaultKeyVersion = await heldVaultVersion(tx, pilotId);
  const rows = await tx.idea.findMany({ where: { id: { in: [ideaId, ...openIds] } }, select: IDEA_CONTEXT_ROW });
  const byId = new Map(rows.map((idea) => [idea.id, toStepIdea(idea)]));
  const idea = byId.get(ideaId);
  return idea ? { idea, open: openIds.flatMap((id) => byId.get(id) ?? []), vaultKeyVersion } : undefined;
};
