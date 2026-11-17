import {
  type AgentSession,
  type EngineId,
  type Hello,
  LIVE_SESSION_STATES,
  RESUMABLE_SESSION_STATES,
  type RoleId,
  type SessionPermissionMode,
  type SessionState,
  type SessionStateMessage,
  type SessionStep,
} from '@crewdeck/contracts';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import type { Prisma } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { assertFresh } from '../realtime/freshness.js';
import { afterCommit, Transactions, type Tx } from '../realtime/transactions.js';
import { RunnerClock } from '../runners/clock.js';
import { RunnerCommands } from '../runners/runner-commands.service.js';
import { type OutgoingRunnerMessage, type RunnerLink, RunnerConnections } from '../runners/runner-connections.js';
import { RunnerDispatcher } from '../runners/runner-dispatcher.js';
import { RunnerPresence } from '../runners/runner-presence.service.js';
import { currentPilotId, runInPilotScope } from '../scope/scope.context.js';
import { SessionHooks } from './session-hooks.js';
import { SESSION_ROW, type SessionRow, startMessageOf, stored, toAgentSession } from './session.view.js';

/** What starts a Session: `base` the Projet's integration branch unless given; `step` the Étape it runs, none when the Pilote writes first. */
export interface StartSession {
  readonly projectId: string;
  readonly role: RoleId;
  readonly engine: EngineId;
  readonly model: string;
  readonly title: string;
  readonly branch: string;
  readonly base?: string;
  readonly step?: SessionStep;
}

/** The Étapes that work in their worktree (ADR 0004's Code and Review): their Moteur acts without asking. */
const BYPASS_STEP_KINDS: ReadonlySet<string> = new Set(['code', 'review', 'cross-review']);

/** The permission mode of a Session, from its Étape's kind: a Rôle the Pilote added can play any part, so never from the Rôle. */
export const permissionModeOf = (step: SessionStep | undefined): SessionPermissionMode => (step && BYPASS_STEP_KINDS.has(step.stepKind) ? 'bypass' : 'auto');

const LIVE: readonly SessionState[] = LIVE_SESSION_STATES;
const RESUMABLE: readonly SessionState[] = RESUMABLE_SESSION_STATES;

const sessionNotFound = (): AppError => notFound('sessions.not-found', MESSAGES['sessions.not-found']);

/**
 * The Sessions (RUNNER-9, ADR 0004): the server decides what runs and asks
 * the Runner (`session.start|stop|resume`); the Runner reports each state
 * (`session.state`). Each change writes `agent-session.upserted` in its
 * transaction; what goes to the Runner leaves after the commit.
 *
 * The Runner away, its live Sessions become `interrupted` (`runner-offline`);
 * at its `hello`, those it was running too (`runner-restarted`), and the
 * ones it still runs are stopped, keeping their Moteur's id: only the
 * Pilote's resume continues them (US-60). A Session started while the Runner
 * is offline stays `starting`, and is sent once it is back.
 *
 * The changes of one Pilote's Sessions run one after the other (the Runner's
 * reports, its going away, its `hello`), in memory: one server process.
 */
@Injectable()
export class SessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly queues = new Map<string, Promise<unknown>>();
  /** The sockets whose `hello` was handled: only those get the Sessions waiting when their Runner comes back online. */
  private readonly greeted = new WeakSet<RunnerLink>();
  private readonly removals: (() => void)[] = [];

  constructor(
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly commands: RunnerCommands,
    private readonly connections: RunnerConnections,
    private readonly presence: RunnerPresence,
    private readonly dispatcher: RunnerDispatcher,
    private readonly clock: RunnerClock,
    private readonly hooks: SessionHooks,
    @InjectPinoLogger(SessionsService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('session.state', (message, context) => this.report(context.pilotId, message));
    this.removals.push(
      this.presence.onAnyOffline((pilotId) => {
        this.serial(pilotId, () => this.transactions.run((tx) => this.interruptAll(tx, pilotId))).catch((error: unknown) =>
          this.logger.error({ err: error }, 'sessions interruption failed'),
        );
      }),
      this.presence.onAnyOnline((pilotId) => {
        const link = this.connections.of(pilotId);
        // A first `hello` is handled by `reconnected`; this is a Runner back at its heartbeat, on a socket already greeted.
        if (!link || !this.greeted.has(link)) return;
        this.serial(pilotId, () => this.sendWaiting(pilotId)).catch((error: unknown) => this.logger.error({ err: error }, 'sessions resend failed'));
      }),
      this.connections.onAccepted((link, hello) => {
        this.serial(link.pilotId, () => this.reconnected(link, hello)).catch((error: unknown) => this.logger.error({ err: error }, 'sessions hello failed'));
      }),
    );
  }

  onModuleDestroy(): void {
    for (const remove of this.removals.splice(0)) remove();
  }

  /**
   * Starts a Session of the current Pilote in `tx`: the row `starting` and
   * its event, then, once committed, `session.start` to the Runner (offline,
   * once it is back). 404 `project.not-found`; 422 `sessions.no-origin` for
   * a Projet whose code is not on GitHub (the Local origin is SOURCE-2's).
   */
  async start(tx: Tx, input: StartSession): Promise<AgentSession> {
    const pilotId = currentPilotId();
    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { integrationBranch: true } });
    if (!project) throw notFound('project.not-found', MESSAGES['project.not-found']);
    const onGithub = await tx.artifactSource.count({ where: { projectId: input.projectId, group: 'code', source: 'github' } });
    if (onGithub === 0) throw unprocessable('sessions.no-origin', MESSAGES['sessions.no-origin']);
    const created = await tx.agentSession.create({
      data: {
        id: newId(),
        pilotId,
        projectId: input.projectId,
        role: input.role,
        engine: stored(input.engine),
        model: input.model,
        title: input.title,
        branch: input.branch,
        base: input.base ?? project.integrationBranch,
        permissionMode: permissionModeOf(input.step),
        state: 'starting',
        stepRunId: input.step?.stepRunId ?? null,
        stepKind: input.step?.stepKind ?? null,
        startedAt: this.clock.now(),
      },
      select: SESSION_ROW,
    });
    const row = await this.written(tx, pilotId, created);
    afterCommit(tx, () => this.trySend(pilotId, startMessageOf(row)));
    return toAgentSession(row);
  }

  /** Every live Session of `pilotId` becomes `interrupted` (`runner-offline`), in `tx`: their Runner went away. */
  async interruptAll(tx: Tx, pilotId: string): Promise<void> {
    const live = await tx.agentSession.findMany({ where: { state: { in: [...LIVE] } }, select: { id: true }, orderBy: { startedAt: 'asc' } });
    for (const { id } of live) await this.change(tx, pilotId, id, { state: 'interrupted', interruptedReason: 'runner_offline' });
  }

  /** `POST /api/sessions/:id/stop`: the Session `stopped` at `endedAt`, its Moteur stopped by the Runner, its worktree and Moteur's id kept. */
  async stop(id: string, seq: bigint): Promise<AgentSession> {
    const pilotId = currentPilotId();
    return this.serial(pilotId, () =>
      this.transactions.run(async (tx) => {
        const row = await this.fresh(tx, id, seq);
        if (!LIVE.includes(row.state)) throw unprocessable('sessions.not-running', MESSAGES['sessions.not-running']);
        const stopped = await this.change(tx, pilotId, id, { state: 'stopped', interruptedReason: null, endedAt: this.clock.now() });
        afterCommit(tx, () => this.trySend(pilotId, { type: 'session.stop', sessionId: id }));
        return toAgentSession(stopped);
      }),
    );
  }

  /**
   * `POST /api/sessions/:id/resume`: a `stopped` or `interrupted` Session
   * `starting` again; the Runner resumes its Moteur's session, or starts it
   * anew when the Moteur never gave its id. 422 `runner.offline` when the
   * Runner is away: a resume waits for no one.
   */
  async resume(id: string, seq: bigint): Promise<AgentSession> {
    const pilotId = currentPilotId();
    return this.serial(pilotId, () =>
      this.transactions.run(async (tx) => {
        const row = await this.fresh(tx, id, seq);
        if (!RESUMABLE.includes(row.state)) throw unprocessable('sessions.not-resumable', MESSAGES['sessions.not-resumable']);
        if (!this.presence.isOnline(pilotId)) throw unprocessable('runner.offline', MESSAGES['runner.offline']);
        const resumed = await this.change(tx, pilotId, id, { state: 'starting', interruptedReason: null, endedAt: null });
        const message: OutgoingRunnerMessage = resumed.engineSessionId === null ? startMessageOf(resumed) : { type: 'session.resume', sessionId: id };
        afterCommit(tx, () => this.trySend(pilotId, message));
        return toAgentSession(resumed);
      }),
    );
  }

  /**
   * The Runner's `session.state`. An `ended` Session stays so; `ended` is
   * always taken (with when, and the in-process hooks of `SessionHooks`); a
   * `stopped` or `interrupted` one waits for the Pilote's resume, whatever the
   * Runner says meanwhile; a live one takes the reported state. A Session
   * unknown, or another Pilote's, is ignored.
   */
  report(pilotId: string, message: SessionStateMessage): Promise<void> {
    return this.serial(pilotId, () =>
      this.transactions.run(async (tx) => {
        const row = await tx.agentSession.findUnique({ where: { id: message.sessionId }, select: { state: true, engineSessionId: true } });
        if (!row || row.state === 'ended') return;
        const engineSessionId = message.engineSessionId ?? row.engineSessionId;
        if (message.state === 'ended') {
          const outcome = message.outcome ?? (message.error ? 'error' : 'ok');
          const ended = await this.change(tx, pilotId, message.sessionId, {
            state: 'ended',
            outcome,
            error: message.error ? stored(message.error) : null,
            interruptedReason: null,
            engineSessionId,
            endedAt: this.clock.now(),
          });
          await this.hooks.ended(tx, toAgentSession(ended));
          return;
        }
        if (!LIVE.includes(row.state)) {
          // The Moteur's id still counts for the resume; the state is the Pilote's to change.
          if (engineSessionId !== row.engineSessionId) await tx.agentSession.update({ where: { id: message.sessionId }, data: { engineSessionId } });
          return;
        }
        if (message.state === row.state && engineSessionId === row.engineSessionId) return;
        await this.change(tx, pilotId, message.sessionId, {
          state: message.state,
          interruptedReason: message.state === 'interrupted' ? 'runner_restarted' : null,
          engineSessionId,
        });
      }),
    );
  }

  /**
   * An accepted `hello`: the Sessions the Runner was running are
   * `interrupted` (`runner-restarted`), those it reports still alive are
   * stopped on it (their Moteur's id kept), and those started while it was
   * away are sent.
   */
  private async reconnected(link: RunnerLink, hello: Hello): Promise<void> {
    const { pilotId } = link;
    const known = new Map((hello.sessions ?? []).map((session) => [session.sessionId, session.alive]));
    const waiting = await this.transactions.run(async (tx) => {
      const live = await tx.agentSession.findMany({ where: { state: { in: [...LIVE] } }, select: { id: true, state: true }, orderBy: { startedAt: 'asc' } });
      const left: string[] = [];
      for (const { id, state } of live) {
        if (state === 'starting' && !known.has(id)) left.push(id);
        else await this.change(tx, pilotId, id, { state: 'interrupted', interruptedReason: 'runner_restarted' });
      }
      const alive = [...known].filter(([, isAlive]) => isAlive).map(([id]) => id);
      const held = alive.length === 0 ? [] : await tx.agentSession.findMany({ where: { id: { in: alive }, state: { not: 'ended' } }, select: { id: true } });
      return { left, held: held.map(({ id }) => id) };
    });
    this.greeted.add(link);
    if (this.connections.of(pilotId) !== link) return;
    for (const id of waiting.held) this.trySend(pilotId, { type: 'session.stop', sessionId: id });
    await this.sendStarting(pilotId, waiting.left);
  }

  /** The Runner back online on a socket already greeted: the Sessions started meanwhile. */
  private async sendWaiting(pilotId: string): Promise<void> {
    const starting = await this.transactions.run((tx) => tx.agentSession.findMany({ where: { state: 'starting' }, select: { id: true } }));
    await this.sendStarting(
      pilotId,
      starting.map(({ id }) => id),
    );
  }

  private async sendStarting(pilotId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.transactions.run((tx) =>
      tx.agentSession.findMany({ where: { id: { in: [...ids] }, state: 'starting' }, select: SESSION_ROW, orderBy: { startedAt: 'asc' } }),
    );
    for (const row of rows) this.trySend(pilotId, row.engineSessionId === null ? startMessageOf(row) : { type: 'session.resume', sessionId: row.id });
  }

  /** The Session `id` of the current Pilote, at `seq` or later: 404 `sessions.not-found`, 409 `realtime.stale`. */
  private async fresh(tx: Tx, id: string, seq: bigint): Promise<SessionRow> {
    const row = await tx.agentSession.findUnique({ where: { id }, select: SESSION_ROW });
    if (!row) throw sessionNotFound();
    assertFresh(row.lastSeq, seq);
    return row;
  }

  /** Changes the Session `id` with `data`, writes its event and keeps its `seq`. */
  private async change(tx: Tx, pilotId: string, id: string, data: Prisma.AgentSessionUpdateInput): Promise<SessionRow> {
    const row = await tx.agentSession.update({ where: { id }, data, select: SESSION_ROW });
    return this.written(tx, pilotId, row);
  }

  private async written(tx: Tx, pilotId: string, row: SessionRow): Promise<SessionRow> {
    const seq = await this.events.write(tx, pilotId, 'agent-session.upserted', toAgentSession(row));
    await tx.agentSession.update({ where: { id: row.id }, data: { lastSeq: seq } });
    return { ...row, lastSeq: seq };
  }

  /** Sends `message` to the Runner when it is online; offline, what it said waits for its return (`reconnected`, `sendWaiting`). */
  private trySend(pilotId: string, message: OutgoingRunnerMessage): void {
    if (!this.presence.isOnline(pilotId)) return;
    try {
      this.commands.send(pilotId, message);
    } catch (error) {
      if (error instanceof AppError && error.code === 'runner.offline') return;
      throw error;
    }
  }

  /** Runs `fn` in `pilotId`'s scope, after the changes of their Sessions already queued. */
  private serial<T>(pilotId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(pilotId) ?? Promise.resolve();
    const run = previous.then(
      () => runInPilotScope(pilotId, fn),
      () => runInPilotScope(pilotId, fn),
    );
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(pilotId, settled);
    void settled.then(() => {
      if (this.queues.get(pilotId) === settled) this.queues.delete(pilotId);
    });
    return run;
  }
}
