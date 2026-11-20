import {
  IDEA_ANALYSIS_NEW_PROJECT,
  IDEA_CLOSED_STATES,
  IDEA_TO_TRIAGE_STATES,
  type Idea,
  type IdeaAnalysisFigures,
  type IdeaAnalysisRun,
  type IdeaState,
  type ReanalyseIdeaInput,
  SESSION_STEP_OPEN_IDEAS_MAX,
  type SessionStepIdeaContext,
  type SetIdeaTargetInput,
  type StepRun,
  zId,
  zIdeaAnalysisRun,
  zSealedItem,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DecisionsService } from '../decisions/decisions.service.js';
import { type AppError, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Engine } from '../process/engine/engine.js';
import type { AgentStepReport } from '../process/engine/kinds/agent.js';
import { roleOf } from '../process/engine/kinds/agent.js';
import type { StepRunContext } from '../process/engine/kinds/handler.js';
import type { StepRunFinished } from '../process/engine/kinds/step-run-hooks.js';
import { STEP_DECISION_KINDS } from '../process/engine/step-decisions.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { assertFresh } from '../realtime/freshness.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import type { WaitingProject } from '../runners/waiting-work.js';
import { currentPilotId } from '../scope/scope.context.js';
import { IDEA_CONTEXT_ROW, SESSION_ROW, toAgentSession, toStepIdea } from '../sessions/session.view.js';
import { IDEA_VIEW, ideaStateOf, ideaStateRow, toIdea } from './idea.view.js';
import { syncIdeasToTriage } from './triage-decision.js';

/** The kind of the Étape that analyses an Idée (US-6, US-48). */
export const IDEA_ANALYSIS_KIND = 'idea-analysis';

/** Why `reanalyse` runs the analysis again, in the StepRun's `reason`. */
export const REANALYSE_REASON = 'reanalyse';

/** What « Runner hors ligne » names the Idées' analyses of no Projet. */
const IDEAS_GROUP = 'Idées';
/** What it names a Projet whose name the server cannot read (SOURCE-2). */
const LOCAL_PROJECT_NAME = 'Projet local';

/**
 * The report of the running analysis, kept until its Contrat passed (the
 * previous analysis shown meanwhile): its StepRun, its figures, and its
 * sentences sealed by the Runner, never opened here (ADR 0003).
 */
const zPendingAnalysis = z.object({
  stepRunId: zId,
  figures: z.object({ impact: z.int(), effort: z.int(), projectId: z.string(), duplicateIds: z.array(zId) }),
  sealed: zSealedItem.nullable(),
});
type PendingAnalysis = z.infer<typeof zPendingAnalysis>;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const TRIAGEABLE: ReadonlySet<IdeaState> = new Set(IDEA_TO_TRIAGE_STATES);
const notTriageable = (): AppError => unprocessable('ideas.not-triageable', MESSAGES['ideas.not-triageable']);
const ideaNotFound = (): AppError => notFound('idea.not-found', MESSAGES['idea.not-found']);
const noAnalysisStep = (): AppError => unprocessable('ideas.no-analysis-step', MESSAGES['ideas.no-analysis-step']);

/**
 * The analysis of an Idée (IDEE-2), the domain part of the `idea-analysis`
 * kind (`process/engine/kinds/idea-analysis.ts` wires it): its admission
 * when it is noted, the Idée `analysing` while its StepRun runs, its report
 * kept until its Contrat passed then applied, the Idée `to-triage` when it
 * did not; the context its Session reads; « Changer » and « Relancer
 * l'analyse ». The server stores the sealed sentences as the Runner sent
 * them and reads only the figures (ADR 0003).
 */
@Injectable()
export class IdeaAnalysis {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly decisions: DecisionsService,
    private readonly engine: Engine,
  ) {}

  /**
   * The Idée `ideaId`, just noted, enters the `idea.noted` Phase of its
   * Projet's active version, or of « Process Crewdeck » without a Projet
   * (PROCESS-5); nothing when that Process has no such Phase. The Process
   * decides, never a setting: a Rôle without a Moteur fails the analysis
   * (`no-engine`), which « Relancer l'analyse » runs once one is set.
   */
  async admit(tx: Tx, ideaId: string, projectId: string | null): Promise<void> {
    const admission = await this.engine.admissionFor(tx, projectId, 'idea.noted');
    if (!admission) return;
    await this.engine.admit(tx, { projectId, phaseId: admission.phaseId, item: { type: 'idea', id: ideaId } });
  }

  /** The StepRun of `run` started its Session: the Idée `analysing`, its run `running` with its Rôle and Moteur. */
  async started(tx: Tx, run: StepRunContext): Promise<void> {
    const idea = await tx.idea.findUnique({ where: { id: run.phaseRun.itemId }, select: { state: true } });
    if (!idea) return;
    const stepRun = await tx.stepRun.findUniqueOrThrow({ where: { id: run.stepRun.id }, select: { sessionId: true } });
    const session = stepRun.sessionId === null ? null : toAgentSession(await tx.agentSession.findUniqueOrThrow({ where: { id: stepRun.sessionId }, select: SESSION_ROW }));
    const analysisRun: IdeaAnalysisRun = {
      stepRunId: run.stepRun.id,
      status: 'running',
      role: session?.role ?? roleOf(run) ?? 'idea',
      engine: session?.engine ?? null,
      at: new Date().toISOString(),
      contractId: null,
      contractVersion: null,
      failedRuleIds: [],
    };
    const triageable = TRIAGEABLE.has(ideaStateOf(idea.state));
    await this.write(tx, run.phaseRun.itemId, {
      ...(triageable ? { state: 'analysing' as const } : {}),
      analysisRun: json(analysisRun),
      analysisPending: json(null),
    });
  }

  /** A valid report of the StepRun of `run`: kept, applied once its Contrat passed. */
  async reported(tx: Tx, run: StepRunContext, report: AgentStepReport<IdeaAnalysisFigures>): Promise<void> {
    const pending: PendingAnalysis = { stepRunId: run.stepRun.id, figures: report.figures, sealed: report.sealed ?? null };
    await tx.idea.updateMany({ where: { id: run.phaseRun.itemId }, data: { analysisPending: json(pending) } });
  }

  /** Whether the Idée of `run` holds the report of that StepRun, which its analysis is made of. */
  async hasReport(tx: Tx, run: StepRunContext): Promise<boolean> {
    const idea = await tx.idea.findUnique({ where: { id: run.phaseRun.itemId }, select: { analysisPending: true } });
    return idea?.analysisPending != null && zPendingAnalysis.parse(idea.analysisPending).stepRunId === run.stepRun.id;
  }

  /**
   * An `idea-analysis` StepRun finished. Passed: its report becomes the
   * Idée's analysis, figures readable, sentences sealed, the Idée `analysed`.
   * Incomplete or failed: the Idée back `to-triage` (US-48), its previous
   * analysis kept, the run saying which rules failed. An Idée triaged since
   * keeps its state.
   */
  async finished(tx: Tx, stepRun: StepRun, finished: StepRunFinished): Promise<void> {
    const phaseRun = await tx.phaseRun.findUnique({ where: { id: stepRun.phaseRunId }, select: { itemType: true, itemId: true } });
    if (phaseRun?.itemType !== 'idea') return;
    const idea = await tx.idea.findUnique({ where: { id: phaseRun.itemId }, select: { state: true, analysisRun: true, analysisPending: true } });
    if (!idea) return;
    const { state, run, applied } = analysisOutcome({
      ideaId: phaseRun.itemId,
      stepRun,
      finished,
      state: ideaStateOf(idea.state),
      before: idea.analysisRun === null ? null : zIdeaAnalysisRun.parse(idea.analysisRun),
      pending: idea.analysisPending === null ? null : zPendingAnalysis.parse(idea.analysisPending),
      at: new Date(),
    });
    const done = { ...(state ? { state: ideaStateRow(state) } : {}), analysisRun: json(run), analysisPending: json(null) };
    if (!applied) {
      await this.write(tx, phaseRun.itemId, done);
      return;
    }
    const target = applied.targetProjectId === null ? null : await tx.project.findUnique({ where: { id: applied.targetProjectId }, select: { id: true } });
    await this.write(tx, phaseRun.itemId, {
      ...done,
      analysis: applied.analysis === null ? json(null) : json(applied.analysis),
      impact: applied.impact,
      effort: applied.effort,
      targetProjectId: target?.id ?? null,
      targetIsNew: applied.targetIsNew,
      duplicateIds: applied.duplicateIds,
      analysedAt: new Date(run.at),
    });
  }

  /** The Pilote stopped the Idée's PhaseRun: an analysis that ran leaves the Idée to triage. */
  async stopped(tx: Tx, ideaId: string): Promise<void> {
    const idea = await tx.idea.findUnique({ where: { id: ideaId }, select: { state: true, analysisRun: true } });
    if (idea?.state !== 'analysing') return;
    const before = idea.analysisRun === null ? null : zIdeaAnalysisRun.parse(idea.analysisRun);
    await this.write(tx, ideaId, {
      state: 'to_triage',
      analysisRun: before ? json({ ...before, status: 'failed', at: new Date().toISOString() }) : json(null),
      analysisPending: json(null),
    });
  }

  /**
   * What the Session of the analysis of `ideaId` reads besides the Miroir:
   * the Idée, and the Pilote's other open Idées, the latest noted first,
   * their texts and analyses sealed as stored (the Runner opens them).
   */
  async context(tx: Tx, ideaId: string): Promise<SessionStepIdeaContext> {
    const [idea, open] = await Promise.all([
      tx.idea.findUniqueOrThrow({ where: { id: ideaId }, select: IDEA_CONTEXT_ROW }),
      tx.idea.findMany({
        where: { id: { not: ideaId }, state: { notIn: IDEA_CLOSED_STATES.map(ideaStateRow) } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SESSION_STEP_OPEN_IDEAS_MAX,
        select: IDEA_CONTEXT_ROW,
      }),
    ]);
    return { idea: toStepIdea(idea), open: open.map(toStepIdea) };
  }

  /** `idea-analysis` of « Runner hors ligne »: the analyses whose Sessions wait to start, by Projet, « Idées » for those of none. */
  async projectsWaiting(): Promise<WaitingProject[]> {
    const waiting = await this.prisma.scoped.agentSession.findMany({
      where: { state: 'starting', stepKind: IDEA_ANALYSIS_KIND },
      select: { projectId: true, project: { select: { displayName: true, name: true } } },
    });
    const byProject = new Map<string | null, { name: string; count: number }>();
    for (const { projectId, project } of waiting) {
      const name = project === null ? IDEAS_GROUP : (project.displayName ?? project.name ?? LOCAL_PROJECT_NAME);
      byProject.set(projectId, { name, count: (byProject.get(projectId)?.count ?? 0) + 1 });
    }
    return [...byProject].map(([projectId, { name, count }]) => ({ projectId, name, items: [{ kind: 'ideas-waiting', count }] }));
  }

  /**
   * « Changer » (`POST /api/ideas/:id/target`): the Projet visé, `null` for
   * « nouveau », without running the analysis again; the running PhaseRun
   * keeps its version. 404 for an Idée or a Projet not the Pilote's, 422
   * `ideas.not-triageable` once merged or rejected, 409 `realtime.stale`.
   */
  setTarget(ideaId: string, { projectId, seq }: SetIdeaTargetInput): Promise<Idea> {
    return this.transactions.run(async (tx) => {
      const idea = await this.lockIdea(tx, ideaId);
      if (isClosed(idea.state)) throw notTriageable();
      if (projectId !== null && !(await tx.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
        throw notFound('project.not-found', MESSAGES['project.not-found']);
      }
      assertFresh(idea.lastSeq, BigInt(seq));
      return this.write(tx, ideaId, { targetProjectId: projectId, targetIsNew: projectId === null });
    });
  }

  /**
   * « Relancer l'analyse » (`POST /api/ideas/:id/reanalyse`), which ends as
   * the Décision's « Relancer l'Étape » does: a failed last analysis is
   * retried (`Engine.retry`, its Décision resolved `rerun`); a passed one
   * runs again in its PhaseRun while it is open (`rerunFrom`), else the Idée
   * enters its `idea.noted` Phase anew. 422 `ideas.analysis-running`,
   * `ideas.not-triageable` (retained, merged or rejected),
   * `ideas.no-analysis-step`; 404; 409 `realtime.stale`.
   */
  reanalyse(ideaId: string, { seq }: ReanalyseIdeaInput): Promise<Idea> {
    return this.transactions.run(async (tx) => {
      const idea = await this.lockIdea(tx, ideaId);
      const run = idea.analysisRun === null ? null : zIdeaAnalysisRun.parse(idea.analysisRun);
      if (idea.state === 'analysing' || run?.status === 'running') throw unprocessable('ideas.analysis-running', MESSAGES['ideas.analysis-running']);
      if (!TRIAGEABLE.has(idea.state)) throw notTriageable();
      assertFresh(idea.lastSeq, BigInt(seq));
      const last = await tx.stepRun.findFirst({
        where: { kind: IDEA_ANALYSIS_KIND, phaseRun: { itemType: 'idea', itemId: ideaId } },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, state: true, stepId: true, phaseRun: { select: { id: true, state: true, projectId: true } } },
      });
      if (!last) throw noAnalysisStep();
      if (last.state === 'failed') {
        const restarted = await this.engine.retry(tx, last.id);
        if (restarted !== null) {
          for (const kind of STEP_DECISION_KINDS) await this.decisions.resolve(tx, kind, last.id, 'rerun');
          return this.read(tx, ideaId);
        }
      }
      if (last.phaseRun.state === 'running' || last.phaseRun.state === 'waiting') {
        await this.engine.rerunFrom(tx, last.phaseRun.id, last.stepId, { reason: REANALYSE_REASON });
        return this.read(tx, ideaId);
      }
      const admission = await this.engine.admissionFor(tx, last.phaseRun.projectId, 'idea.noted');
      if (!admission?.steps.some((step) => step.kind === IDEA_ANALYSIS_KIND)) throw noAnalysisStep();
      await this.engine.admit(tx, { projectId: last.phaseRun.projectId, phaseId: admission.phaseId, item: { type: 'idea', id: ideaId } });
      return this.read(tx, ideaId);
    });
  }

  /** The Idée `ideaId`, after the Pilote's row is locked (ADR 0007): 404 for none of theirs. */
  private async lockIdea(tx: Tx, ideaId: string): Promise<{ state: IdeaState; lastSeq: bigint; analysisRun: unknown }> {
    const id = zId.safeParse(ideaId);
    if (!id.success) throw ideaNotFound();
    await this.events.lock(tx, currentPilotId());
    const idea = await tx.idea.findUnique({ where: { id: id.data }, select: { state: true, lastSeq: true, analysisRun: true } });
    if (!idea) throw ideaNotFound();
    return { ...idea, state: ideaStateOf(idea.state) };
  }

  private async read(tx: Tx, ideaId: string): Promise<Idea> {
    return toIdea(await tx.idea.findUniqueOrThrow({ where: { id: ideaId }, select: IDEA_VIEW }));
  }

  /** Writes `data` on the Idée, then its `idea.upserted` and the Décision « Idées à trier » in the same transaction. */
  private async write(tx: Tx, ideaId: string, data: Prisma.IdeaUncheckedUpdateInput): Promise<Idea> {
    const row = await tx.idea.update({ where: { id: ideaId }, data: { ...data, updatedAt: new Date() }, select: IDEA_VIEW });
    const idea = toIdea(row);
    const pilotId = currentPilotId();
    const seq = await this.events.write(tx, pilotId, 'idea.upserted', idea);
    await tx.idea.update({ where: { id: ideaId }, data: { lastSeq: seq } });
    await syncIdeasToTriage(tx, pilotId, this.decisions);
    return idea;
  }
}

/** What `analysisOutcome` is given: the finished StepRun, and the Idée's state, last run and pending report. */
export interface FinishedAnalysis {
  readonly ideaId: string;
  readonly stepRun: Pick<StepRun, 'id' | 'contratVerdict'>;
  readonly finished: StepRunFinished;
  readonly state: IdeaState;
  readonly before: IdeaAnalysisRun | null;
  readonly pending: PendingAnalysis | null;
  readonly at: Date;
}

/** The analysis a passed StepRun gives its Idée: figures readable, sentences sealed as the Runner sent them. */
export interface AppliedAnalysis {
  readonly analysis: PendingAnalysis['sealed'];
  readonly impact: number;
  readonly effort: number;
  readonly targetProjectId: string | null;
  readonly targetIsNew: boolean;
  readonly duplicateIds: string[];
}

/**
 * What a finished analysis does to its Idée (US-6, US-48). Passed with its
 * own report: the report applied, the Idée `analysed`. Otherwise (its
 * Contrat incomplete, its Session failed, or a report of another StepRun):
 * the Idée `to-triage`, its previous analysis kept, the run saying the rules
 * that failed. An Idée triaged since keeps its state (`state: null`).
 */
export const analysisOutcome = ({ ideaId, stepRun, finished, state, before, pending, at }: FinishedAnalysis): { state: IdeaState | null; run: IdeaAnalysisRun; applied: AppliedAnalysis | null } => {
  const verdict = finished.verdict ?? stepRun.contratVerdict;
  const run: IdeaAnalysisRun = {
    stepRunId: stepRun.id,
    status: finished.status,
    role: before?.role ?? 'idea',
    // The Moteur of its own Session only: a StepRun that started none (`no-engine`) ran on no Moteur.
    engine: before?.stepRunId === stepRun.id ? before.engine : null,
    at: at.toISOString(),
    contractId: verdict?.contractId ?? null,
    contractVersion: verdict?.version ?? null,
    failedRuleIds: finished.status === 'passed' ? [] : (verdict?.failedRuleIds ?? []),
    ...(finished.status === 'failed' && finished.failure !== undefined ? { failure: finished.failure } : {}),
  };
  const triageable = TRIAGEABLE.has(state);
  if (finished.status !== 'passed' || pending?.stepRunId !== stepRun.id) return { state: triageable ? 'to-triage' : null, run, applied: null };
  const { figures } = pending;
  const isNew = figures.projectId === IDEA_ANALYSIS_NEW_PROJECT;
  return {
    state: triageable ? 'analysed' : null,
    run,
    applied: {
      analysis: pending.sealed,
      impact: figures.impact,
      effort: figures.effort,
      targetProjectId: isNew ? null : figures.projectId,
      targetIsNew: isNew,
      duplicateIds: figures.duplicateIds.filter((id) => id !== ideaId),
    },
  };
};

const isClosed = (state: IdeaState): boolean => (IDEA_CLOSED_STATES as readonly IdeaState[]).includes(state);
