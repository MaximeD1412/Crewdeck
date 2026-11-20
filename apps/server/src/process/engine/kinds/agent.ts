import {
  AGENT_KINDS,
  type AgentKind,
  type AgentSession,
  type ArtifactRef,
  CATALOGUE,
  CONTRATS,
  type RoleId,
  type SealedItem,
  type SealedSessionTitle,
  type SessionStep,
  type SessionStepInput,
  type StepReport,
  type Verdict,
  zSessionMcpServer,
} from '@crewdeck/contracts';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { z } from 'zod';
import { unprocessable } from '../../../errors/app-error.js';
import { MESSAGES } from '../../../errors/messages.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { afterCommit, Transactions, type Tx } from '../../../realtime/transactions.js';
import { RunnerDispatcher } from '../../../runners/runner-dispatcher.js';
import { RunnerOffline } from '../../../runners/runner-offline.service.js';
import { RunnerPresence } from '../../../runners/runner-presence.service.js';
import { RunnerWaitingWork, type WaitingProject } from '../../../runners/waiting-work.js';
import { currentPilotId } from '../../../scope/scope.context.js';
import { SessionHooks } from '../../../sessions/session-hooks.js';
import { SessionsService } from '../../../sessions/sessions.service.js';
import { SettingsService } from '../../../settings/settings.service.js';
import { Engine } from '../engine.js';
import type { StepKindHandler, StepResult, StepRunContext, StepStartFailed } from './handler.js';
import { heldVaultVersion } from '../../../vault/sealed-write.js';
import { StepRunHooks } from './step-run-hooks.js';

/**
 * The agent Étapes (RUNNER-12, ADR 0004): one way for each agent kind to
 * start its Session from the Étape's Outils, carry its Entrées to the Skill
 * as references, and finish its StepRun on the verdict of its Contrat. Each
 * Étape's ticket (IDEE-2, BOUCLE-3, CONCEPTION-3…) calls `defineAgentKind`
 * for its kind and adds the handler to `STEP_KIND_HANDLERS`, then, when its
 * Skill reports, `registerStepReport`.
 */

/** What an agent kind says of its StepRun: its Session's title and branch, and its outputs once its Contrat passed. */
export interface AgentKindSpec {
  readonly kind: AgentKind;
  /** The id of its Contrat in `CONTRATS`: the catalogue's unless given, `null` for none. */
  readonly contractId?: string | null;
  /** The Ticket's or the Conception's title, as its Source holds it: readable, or sealed when Local. */
  title(tx: Tx, run: StepRunContext): Promise<string | SealedSessionTitle> | string | SealedSessionTitle;
  /** Its Session's branch; `null` for a scratch Session, which reads no code and may have no Projet (IDEE-2). */
  branch(tx: Tx, run: StepRunContext): Promise<string | null> | string | null;
  outputs(tx: Tx, run: StepRunContext): Promise<ArtifactRef[]> | ArtifactRef[];
  /** What the Skill is given besides its Entrées, sealed for the Runner only (the Idées of an analysis, IDEE-2). */
  stepContext?(tx: Tx, run: StepRunContext): Promise<Pick<SessionStep, 'ideas'>>;
  /** `own`: the kind lists its waiting Sessions in « Runner hors ligne » itself, not under `step-runs`. */
  readonly waitingWork?: 'own';
  /**
   * `fail`: a Rôle without a Moteur fails the StepRun `no-engine` (« Étape
   * échouée », retried once a Moteur is set) instead of refusing its start
   * (422 `step-run.no-engine`): for a kind the Process starts on its own,
   * which no Pilote's call is there to refuse to.
   */
  readonly withoutEngine?: 'fail';
}

/** What a kind's module is given of a valid `step.report`: its figures as its schema reads them, and its sealed content, to store, never to open. */
export interface AgentStepReport<T> {
  readonly figures: T;
  readonly sealed?: SealedItem;
}

export type StepReportHandler<T> = (tx: Tx, run: StepRunContext, report: AgentStepReport<T>) => Promise<void>;

/** Whether the kind's module holds a valid report of the StepRun of `run`, which its Sortie is made of. */
export type StepReportReceived = (tx: Tx, run: StepRunContext) => Promise<boolean>;

/** The failures of an agent's StepRun: codes, never text (ADR 0003). */
export const AGENT_STEP_FAILURES = {
  sessionError: 'session-error',
  sessionStopped: 'session-stopped',
  sessionInterrupted: 'session-interrupted',
  contractIncomplete: 'contract-incomplete',
  contractUnchecked: 'contract-unchecked',
  noEngine: 'no-engine',
} as const;

/** The rule an invalid `step.report` fails, in the StepRun's `contratVerdict`. */
export const REPORT_SCHEMA_RULE = 'report.schema';

/** The rule a StepRun fails whose Session ended, its Contrat passed, without the report its kind reads. */
export const REPORT_MISSING_RULE = 'report.missing';

/** What the engine is given for an agent's StepRun: a message of its Skill, or a change of its Session. */
export type AgentSignal =
  | { readonly kind: 'step.started' }
  | { readonly kind: 'step.report'; readonly report: StepReport }
  | { readonly kind: 'step.verdict'; readonly verdict: Verdict }
  | { readonly kind: 'session'; readonly session: AgentSession };

const SIGNAL_KINDS: ReadonlySet<string> = new Set(['step.started', 'step.report', 'step.verdict', 'session']);
const isAgentSignal = (signal: unknown): signal is AgentSignal =>
  typeof signal === 'object' && signal !== null && SIGNAL_KINDS.has(String((signal as { kind?: unknown }).kind));

const AGENT: ReadonlySet<string> = new Set(AGENT_KINDS);

/** What « Runner hors ligne » names a Projet whose name the server cannot read. */
const LOCAL_PROJECT_NAME = 'Projet local';

/** A numeric id (a Ticket's, a change's) is also given as its number. */
const NUMBER = /^[1-9]\d{0,9}$/;

/**
 * The Entrées of `run` as the Skill gets them (ADR 0011): one per Artefact
 * that fed an Entrée, by reference; an Entrée nothing fed as `ref: null`, its
 * type the Étape's port's.
 */
export const sessionInputsOf = (run: Pick<StepRunContext, 'stepRun' | 'step'>): SessionStepInput[] =>
  run.stepRun.inputs.flatMap((input): SessionStepInput[] => {
    const type = run.step.inputs.find((port) => port.id === input.portId)?.type ?? input.artifacts[0]?.type;
    if (input.absent || input.artifacts.length === 0) return type ? [{ portId: input.portId, type, ref: null }] : [];
    return input.artifacts.map((artifact) => ({
      portId: input.portId,
      type: artifact.type,
      ref: { id: artifact.id, ...(NUMBER.test(artifact.id) ? { number: Number(artifact.id) } : {}), ...(artifact.sha ? { sha: artifact.sha } : {}) },
    }));
  });

/** The Rôle of the Étape: its `role` Outil, else its kind's. */
export const roleOf = (run: Pick<StepRunContext, 'step'>): RoleId | null =>
  run.step.tools.find((tool) => tool.kind === 'role')?.roleId ?? CATALOGUE[run.step.kind].role;

/** The Skill of the Étape: its `skill` Outil, else its kind's. */
export const skillOf = (run: Pick<StepRunContext, 'step'>): string | null =>
  run.step.tools.find((tool) => tool.kind === 'skill')?.skillId ?? CATALOGUE[run.step.kind].skill;

/** The names of the Étape's Serveurs MCP, in its order (RUNNER-17 mounts them). */
export const mcpServersOf = (run: Pick<StepRunContext, 'step'>): string[] =>
  run.step.tools.flatMap((tool) => (tool.kind === 'mcp' ? [zSessionMcpServer.parse(tool.name)] : []));

const contractIdOf = (spec: AgentKindSpec): string | null => (spec.contractId === undefined ? CATALOGUE[spec.kind].contrat : spec.contractId);

/** The version of the Contrat `contractId` the Runner checks, 1 while it has none registered. */
const contratVersionOf = (contractId: string): number => CONTRATS.find((contrat) => contrat.id === contractId)?.version ?? 1;

/** The Runner's verdict, kept `incomplete` with `report.schema` when a report of the StepRun was refused before it. */
const withRefusedReport = (verdict: Verdict, before: Verdict | null): Verdict =>
  before?.failedRuleIds.includes(REPORT_SCHEMA_RULE) ? { ...verdict, status: 'incomplete', failedRuleIds: [...new Set([...verdict.failedRuleIds, REPORT_SCHEMA_RULE])] } : verdict;

/**
 * The Session's change that finishes its StepRun: its end, and what its
 * Contrat said. A kind without Contrat passes, unless its report was refused
 * (a verdict `report.schema` of its own).
 */
/** The verdict `before` (the rules its Contrat failed kept), `incomplete` with the report's rule `ruleId` (refused or missing). */
const refusedVerdict = (contractId: string, before: Verdict | null, ruleId: string): Verdict => ({
  contractId,
  version: before?.version ?? contratVersionOf(contractId),
  status: 'incomplete',
  failedRuleIds: [...new Set([...(before?.failedRuleIds ?? []), ruleId])],
  warningRuleIds: before?.warningRuleIds ?? [],
  ...(before?.headSha ? { headSha: before.headSha } : {}),
});

const outcomeOf = (contractId: string | null, session: AgentSession, verdict: Verdict | null): { finished: 'passed' } | { finished: 'incomplete'; verdict: Verdict } | { finished: 'failed'; failure: string } => {
  if (session.outcome === 'error') return { finished: 'failed', failure: AGENT_STEP_FAILURES.sessionError };
  if (contractId === null && !verdict) return { finished: 'passed' };
  if (!verdict) return { finished: 'failed', failure: AGENT_STEP_FAILURES.contractUnchecked };
  return verdict.status === 'passed' ? { finished: 'passed' } : { finished: 'incomplete', verdict };
};

@Injectable()
export class AgentSteps implements OnModuleInit, OnModuleDestroy {
  private readonly reports = new Map<AgentKind, { schema: z.ZodType; handler: StepReportHandler<unknown>; received: StepReportReceived }>();
  private readonly removals: (() => void)[] = [];
  /** The Sessions this handler is stopping, whose `stopped` is not the Pilote's. */
  private readonly stopping = new Set<string>();
  /** The kinds whose waiting Sessions their own module lists (`waitingWork: 'own'`). */
  private readonly ownWaitingWork = new Set<AgentKind>();

  constructor(
    private readonly engine: Engine,
    private readonly sessions: SessionsService,
    private readonly sessionHooks: SessionHooks,
    private readonly settings: SettingsService,
    private readonly hooks: StepRunHooks,
    private readonly transactions: Transactions,
    private readonly dispatcher: RunnerDispatcher,
    private readonly presence: RunnerPresence,
    private readonly offline: RunnerOffline,
    private readonly work: RunnerWaitingWork,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AgentSteps.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    const toSession = async (tx: Tx, session: AgentSession): Promise<void> => {
      if (session.stepRunId === null || this.stopping.has(session.id)) return;
      if (session.state === 'starting' || session.state === 'waiting') return;
      await this.engine.signal(tx, session.stepRunId, { kind: 'session', session } satisfies AgentSignal);
    };
    this.removals.push(
      this.sessionHooks.onChanged((tx, session) => (session.state === 'ended' ? Promise.resolve() : toSession(tx, session))),
      this.sessionHooks.onEnded(toSession),
      this.work.register({ key: 'step-runs', projectsWaiting: () => this.projectsWaiting() }),
    );
    this.dispatcher.registerRunnerHandler('step.started', (message) => this.fromRunner(message.stepRunId, { kind: 'step.started' }));
    this.dispatcher.registerRunnerHandler('step.report', (message) => this.fromRunner(message.stepRunId, { kind: 'step.report', report: message }));
    this.dispatcher.registerRunnerHandler('step.verdict', (message) => this.fromRunner(message.stepRunId, { kind: 'step.verdict', verdict: message.verdict }));
  }

  onModuleDestroy(): void {
    for (const remove of this.removals.splice(0)) remove();
  }

  /**
   * The handler of the agent kind `spec.kind`, for `STEP_KIND_HANDLERS`.
   * `start`: the Session of the Étape's Rôle, on its Moteur and model in
   * effect for the Projet, with its Skill, Contrat, Entrées and Serveurs
   * MCP; its id on the StepRun. `onSignal`: the StepRun `running` as its
   * Skill starts or its Session is active again, `interrupted` while its
   * Session is stopped or cut, and once its Session ended: done with
   * `spec.outputs` when its Contrat passed (or it has none), failed
   * otherwise (`StepRunHooks.onFinished` once, in the transaction).
   */
  defineAgentKind(spec: AgentKindSpec): StepKindHandler {
    if (!AGENT.has(spec.kind)) throw new Error(`${spec.kind} is not an agent kind.`);
    if (spec.waitingWork === 'own') this.ownWaitingWork.add(spec.kind);
    return {
      kind: spec.kind,
      start: (tx, run) => this.start(tx, run, spec),
      onSignal: (tx, run, signal) => (isAgentSignal(signal) ? this.onSignal(tx, run, spec, signal) : Promise.resolve(null)),
      stop: (tx, run) => this.stop(tx, run),
    };
  }

  /**
   * What a valid `step.report` of `kind`'s Skill is given to: `schema`
   * reads its figures, `handler` stores them, and its sealed content, with
   * the kind's own model. A report whose figures `schema` refuses fails the
   * StepRun `incomplete`, rule `report.schema`, once its Session ended; so
   * does one never sent (`received` says none is held), rule
   * `report.missing`, whatever the Contrat said of the files. One per kind.
   */
  registerStepReport<T>(kind: AgentKind, schema: z.ZodType<T>, handler: StepReportHandler<T>, received: StepReportReceived): void {
    if (this.reports.has(kind)) throw new Error(`A step.report handler of ${kind} is already registered.`);
    this.reports.set(kind, { schema, handler: handler as StepReportHandler<unknown>, received });
  }

  private async start(tx: Tx, run: StepRunContext, spec: AgentKindSpec): Promise<'running' | StepStartFailed> {
    const projectId = run.phaseRun.projectId;
    const branch = await spec.branch(tx, run);
    // Only a scratch Session runs without a Projet (an Idée noted without one, US-5): no code to run in.
    if (projectId === null && branch !== null) throw new Error(`The StepRun ${run.stepRun.id} of ${spec.kind} has no Projet to start its Session in.`);
    const role = roleOf(run);
    const skill = skillOf(run);
    if (role === null || skill === null) throw new Error(`The kind ${spec.kind} has no Rôle or Skill.`);
    const pilotId = currentPilotId();
    const { roles } = await this.settings.effective(pilotId, projectId ?? undefined);
    const choice = roles[role] ?? null;
    if (!choice && spec.withoutEngine === 'fail') {
      await this.hooks.finished(tx, run.stepRun, { status: 'failed', failure: AGENT_STEP_FAILURES.noEngine });
      return { state: 'failed', failure: AGENT_STEP_FAILURES.noEngine };
    }
    if (!choice) throw unprocessable('step-run.no-engine', MESSAGES['step-run.no-engine']);
    const step: SessionStep = {
      stepRunId: run.stepRun.id,
      stepKind: spec.kind,
      skill,
      contractId: contractIdOf(spec),
      inputs: sessionInputsOf(run),
      ...(spec.stepContext ? await spec.stepContext(tx, run) : {}),
    };
    const session = await this.sessions.start(tx, {
      projectId,
      role,
      engine: choice.engine,
      model: choice.model,
      title: await spec.title(tx, run),
      branch,
      step,
      mcpServers: mcpServersOf(run),
    });
    await this.engine.recordSession(tx, run, session.id);
    if (!this.presence.isOnline(pilotId)) {
      afterCommit(tx, () => {
        this.offline.refresh(pilotId).catch((error: unknown) => this.logger.error({ err: error }, 'runner offline refresh failed'));
      });
    }
    return 'running';
  }

  private async onSignal(tx: Tx, run: StepRunContext, spec: AgentKindSpec, signal: AgentSignal): Promise<StepResult | null> {
    if (signal.kind !== 'session' && run.stepRun.sessionId === null) return null;
    switch (signal.kind) {
      case 'step.started':
        return run.stepRun.state === 'running' ? null : { state: 'running' };
      case 'step.verdict':
        await this.engine.recordContratVerdict(tx, run, withRefusedReport(signal.verdict, run.stepRun.contratVerdict));
        return null;
      case 'step.report':
        return this.onReport(tx, run, spec, signal.report);
      case 'session':
        return this.onSession(tx, run, spec, signal.session);
    }
  }

  private async onSession(tx: Tx, run: StepRunContext, spec: AgentKindSpec, session: AgentSession): Promise<StepResult | null> {
    if (session.id !== run.stepRun.sessionId) return null;
    switch (session.state) {
      case 'active':
        return run.stepRun.state === 'running' ? null : { state: 'running' };
      case 'stopped':
        return { state: 'interrupted', failure: AGENT_STEP_FAILURES.sessionStopped };
      case 'interrupted':
        return { state: 'interrupted', failure: AGENT_STEP_FAILURES.sessionInterrupted };
      case 'ended':
        return this.onEnded(tx, run, spec, session);
      default:
        return null;
    }
  }

  private async onEnded(tx: Tx, run: StepRunContext, spec: AgentKindSpec, session: AgentSession): Promise<StepResult> {
    const contractId = contractIdOf(spec);
    const outcome = outcomeOf(contractId, session, run.stepRun.contratVerdict);
    const verdict = run.stepRun.contratVerdict ?? undefined;
    switch (outcome.finished) {
      case 'passed': {
        const registered = this.reports.get(spec.kind);
        if (registered && !(await registered.received(tx, run))) {
          // Its Sortie is its report: a Contrat met on the files alone gives nothing to pass on (US-48).
          const missing = refusedVerdict(contractIdOf(spec) ?? spec.kind, run.stepRun.contratVerdict, REPORT_MISSING_RULE);
          await this.engine.recordContratVerdict(tx, run, missing);
          await this.hooks.finished(tx, run.stepRun, { status: 'incomplete', verdict: missing, failure: AGENT_STEP_FAILURES.contractIncomplete });
          return { state: 'failed', failure: AGENT_STEP_FAILURES.contractIncomplete };
        }
        const outputs = await spec.outputs(tx, run);
        await this.hooks.finished(tx, run.stepRun, { status: 'passed', ...(verdict ? { verdict } : {}) });
        return { state: 'done', outputs };
      }
      case 'incomplete':
        await this.hooks.finished(tx, run.stepRun, { status: 'incomplete', verdict: outcome.verdict, failure: AGENT_STEP_FAILURES.contractIncomplete });
        return { state: 'failed', failure: AGENT_STEP_FAILURES.contractIncomplete };
      case 'failed':
        await this.hooks.finished(tx, run.stepRun, { status: 'failed', ...(verdict ? { verdict } : {}), failure: outcome.failure });
        return { state: 'failed', failure: outcome.failure };
    }
  }

  /**
   * A `step.report`: its figures read by the kind's schema and given to its
   * module; refused, `report.schema` goes in the StepRun's `contratVerdict`,
   * `incomplete` (the rules its Contrat failed before kept, and kept in the
   * Runner's verdict that follows). The StepRun stays running until its
   * Session ended, then fails `contract-incomplete`: its Session holds its
   * branch until then, and the engine's stop still reaches it. A kind that
   * registered no schema reads no report: ignored.
   */
  private async onReport(tx: Tx, run: StepRunContext, spec: AgentKindSpec, report: StepReport): Promise<StepResult | null> {
    const registered = this.reports.get(spec.kind);
    if (!registered) {
      this.logger.warn({ kind: spec.kind, stepRunId: run.stepRun.id }, 'step.report of a kind without a report schema');
      return null;
    }
    if (report.sealed && report.vaultKeyVersion !== (await heldVaultVersion(tx, currentPilotId()))) {
      // Sealed under a key a rotation replaced since: kept nowhere, the Runner seals it again once it holds the new one (E2E-4).
      this.logger.warn({ kind: spec.kind, stepRunId: run.stepRun.id, vaultKeyVersion: report.vaultKeyVersion ?? null }, 'step.report sealed under a vault key version not current');
      return null;
    }
    const figures = registered.schema.safeParse(report.figures);
    if (figures.success) {
      await registered.handler(tx, run, { figures: figures.data, ...(report.sealed ? { sealed: report.sealed } : {}) });
      return null;
    }
    await this.engine.recordContratVerdict(tx, run, refusedVerdict(contractIdOf(spec) ?? spec.kind, run.stepRun.contratVerdict, REPORT_SCHEMA_RULE));
    return null;
  }

  /** The StepRun stopped or undone: its live Session stopped with it, not taken for the Pilote's stop. */
  private async stop(tx: Tx, run: StepRunContext): Promise<void> {
    const sessionId = run.stepRun.sessionId;
    if (sessionId === null) return;
    this.stopping.add(sessionId);
    try {
      await this.sessions.stopIn(tx, sessionId);
    } finally {
      this.stopping.delete(sessionId);
    }
  }

  /** A message of a Step's Skill from the Runner: given to its StepRun's handler, in the Pilote's scope (the dispatcher's). */
  private async fromRunner(stepRunId: string, signal: AgentSignal): Promise<void> {
    try {
      await this.transactions.run((tx) => this.engine.signal(tx, stepRunId, signal));
    } catch (error) {
      // A message that cannot be taken is logged, never the Runner's socket closed for it.
      this.logger.error({ err: error, type: signal.kind, stepRunId }, 'step message failed');
    }
  }

  /** `step-runs` of « Runner hors ligne »: the Projets whose agent StepRuns' Sessions wait to start, their count each. */
  private async projectsWaiting(): Promise<WaitingProject[]> {
    const waiting = await this.prisma.scoped.agentSession.findMany({
      where: { state: 'starting', stepRunId: { not: null }, ...(this.ownWaitingWork.size > 0 ? { stepKind: { notIn: [...this.ownWaitingWork] } } : {}) },
      select: { projectId: true, project: { select: { displayName: true, name: true } } },
    });
    const byProject = new Map<string, { name: string; count: number }>();
    for (const { projectId, project } of waiting) {
      if (projectId === null || project === null) continue;
      const known = byProject.get(projectId);
      // A Local Projet's name is sealed (SOURCE-2): the Décision names it by its kind.
      byProject.set(projectId, { name: project.displayName ?? project.name ?? LOCAL_PROJECT_NAME, count: (known?.count ?? 0) + 1 });
    }
    return [...byProject].map(([projectId, { name, count }]) => ({ projectId, name, items: [{ kind: 'step-queued', count }] }));
  }
}
