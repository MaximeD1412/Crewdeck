import type { RunnerMessageOf, ServerMessage, SessionRelayError } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../../errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type TabMessage, type TabSocket, WS_TABS, type WsTabHandlers } from '../../realtime/ws-tabs.js';
import { RunnerCommands } from '../../runners/runner-commands.service.js';
import { type OutgoingRunnerMessage, RunnerConnections } from '../../runners/runner-connections.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';
import { runInPilotScope } from '../../scope/scope.context.js';

/**
 * A tab that opened a Session, and the first `seq` it has not been sent with
 * every one before it: where its replay starts again, at the cost of frames
 * it already has (the tab drops them).
 */
interface Opened {
  readonly tab: TabSocket;
  next: number;
}

type TabOf<T extends TabMessage['type']> = Extract<TabMessage, { type: T }>;

/**
 * The relay of a Session (SESSION-1, ADR 0003 and 0007, `docs/security/e2e.md`
 * « Sessions »): the frames of a Session, sealed by the Runner or by a tab
 * under the Session's key, go from one to the other through this server,
 * which reads their ids and `seq` and keeps none of them, not even in memory
 * once forwarded, never writes them to the database nor logs them.
 *
 * - `session.open` of a tab: the Session must be its Pilote's, else
 *   `session.error session.not-found` and nothing for the Runner; the tab
 *   then follows it, and the Runner is asked for its replay to the tab
 *   (`session.replay`). Runner offline: `session.error
 *   session.runner-offline`, the tab still follows it, and its replay is
 *   asked once the Runner's `hello` is accepted.
 * - `session.close`, or the tab's socket closed: it stops following it.
 * - `session.input`: to the Runner, with the tab's `tabId`, for a Session of
 *   the Pilote; offline, `session.runner-offline`.
 * - `session.keys` and `relay` of the Runner: to the tab of its `tabId`, else
 *   to every tab that follows the Session; a Pilote's other tabs get nothing.
 *
 * Per Pilote, in memory (one server process): the tabs that follow each
 * Session. A tab's messages are handled one after the other.
 */
@Injectable()
export class SessionRelay implements OnModuleInit, OnModuleDestroy {
  /** pilotId → sessionId → tabId → the tab. */
  private readonly opened = new Map<string, Map<string, Map<string, Opened>>>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly closedTabs = new WeakSet<TabSocket>();
  private readonly removals: (() => void)[] = [];

  constructor(
    @Inject(WS_TABS) private readonly tabs: WsTabHandlers,
    private readonly prisma: PrismaService,
    private readonly commands: RunnerCommands,
    private readonly connections: RunnerConnections,
    private readonly dispatcher: RunnerDispatcher,
    @InjectPinoLogger(SessionRelay.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.tabs.add({
      types: ['session.open', 'session.close', 'session.input'],
      handle: (tab, message) => this.serial(tab, () => this.fromTab(tab, message)),
      closed: (tab) => this.forgetTab(tab),
    });
    this.dispatcher.registerRunnerHandler('session.keys', (message, context) => this.fromRunner(context.pilotId, message));
    this.dispatcher.registerRunnerHandler('relay', (message, context) => this.fromRunner(context.pilotId, message));
    this.removals.push(this.connections.onAccepted((link) => this.replayAll(link.pilotId)));
  }

  onModuleDestroy(): void {
    for (const remove of this.removals.splice(0)) remove();
  }

  private serial(tab: TabSocket, fn: () => Promise<void>): void {
    const next = (this.queues.get(tab.tabId) ?? Promise.resolve()).then(fn).catch((error: unknown) => {
      this.logger.error({ err: error, tabId: tab.tabId }, 'session relay failed');
    });
    this.queues.set(tab.tabId, next);
    void next.then(() => {
      if (this.queues.get(tab.tabId) === next) this.queues.delete(tab.tabId);
    });
  }

  private async fromTab(tab: TabSocket, message: TabMessage): Promise<void> {
    if (this.closedTabs.has(tab)) return;
    this.logger.debug({ direction: 'in', type: message.type, sessionId: message.sessionId }, 'session relay');
    switch (message.type) {
      case 'session.open':
        return this.open(tab, message);
      case 'session.close':
        return this.unfollow(tab, message.sessionId);
      case 'session.input':
        return this.input(tab, message);
    }
  }

  private async open(tab: TabSocket, { sessionId, fromSeq }: TabOf<'session.open'>): Promise<void> {
    if (!(await this.isPilots(tab.pilotId, sessionId))) return this.refuse(tab, sessionId, 'session.not-found');
    if (this.closedTabs.has(tab)) return;
    this.follow(tab, sessionId, fromSeq);
    this.toRunner(tab, { type: 'session.replay', sessionId, tabId: tab.tabId, fromSeq });
  }

  private async input(tab: TabSocket, { type, sessionId, inputId, nonce, ciphertext }: TabOf<'session.input'>): Promise<void> {
    const follows = this.opened.get(tab.pilotId)?.get(sessionId)?.has(tab.tabId) ?? false;
    if (!follows && !(await this.isPilots(tab.pilotId, sessionId))) return this.refuse(tab, sessionId, 'session.not-found');
    this.toRunner(tab, { type, sessionId, tabId: tab.tabId, inputId, nonce, ciphertext });
  }

  /** Whether `sessionId` is one of `pilotId`'s Sessions: a read in their scope. */
  private async isPilots(pilotId: string, sessionId: string): Promise<boolean> {
    const row = await runInPilotScope(pilotId, () => this.prisma.scoped.agentSession.findUnique({ where: { id: sessionId }, select: { id: true } }));
    return row !== null;
  }

  private toRunner(tab: TabSocket, message: OutgoingRunnerMessage & { sessionId: string }): void {
    try {
      this.commands.send(tab.pilotId, message);
    } catch (error) {
      if (error instanceof AppError && error.code === 'runner.offline') return this.refuse(tab, message.sessionId, 'session.runner-offline');
      throw error;
    }
  }

  private refuse(tab: TabSocket, sessionId: string, code: SessionRelayError): void {
    tab.send({ type: 'session.error', sessionId, code });
  }

  private follow(tab: TabSocket, sessionId: string, fromSeq: number): void {
    const sessions = this.opened.get(tab.pilotId) ?? new Map<string, Map<string, Opened>>();
    const followers = sessions.get(sessionId) ?? new Map<string, Opened>();
    followers.set(tab.tabId, { tab, next: fromSeq });
    sessions.set(sessionId, followers);
    this.opened.set(tab.pilotId, sessions);
  }

  private unfollow(tab: TabSocket, sessionId: string): void {
    const sessions = this.opened.get(tab.pilotId);
    const followers = sessions?.get(sessionId);
    followers?.delete(tab.tabId);
    if (followers?.size === 0) sessions?.delete(sessionId);
    if (sessions?.size === 0) this.opened.delete(tab.pilotId);
  }

  private forgetTab(tab: TabSocket): void {
    this.closedTabs.add(tab);
    for (const sessionId of [...(this.opened.get(tab.pilotId)?.keys() ?? [])]) this.unfollow(tab, sessionId);
  }

  /** A frame of the Runner: to the tab of its `tabId` if it follows the Session, else to every tab that does. */
  private fromRunner(pilotId: string, message: RunnerMessageOf<'session.keys'> | RunnerMessageOf<'relay'>): void {
    const followers = this.opened.get(pilotId)?.get(message.sessionId);
    const to = message.tabId === undefined ? [...(followers?.values() ?? [])] : [followers?.get(message.tabId)].filter((opened) => opened !== undefined);
    this.logger.debug({ direction: 'in', type: message.type, sessionId: message.sessionId, tabs: to.length }, 'session relay');
    const frame: ServerMessage =
      message.type === 'relay'
        ? { type: 'relay', sessionId: message.sessionId, seq: message.seq, nonce: message.nonce, ciphertext: message.ciphertext }
        : { type: 'session.keys', sessionId: message.sessionId, wraps: message.wraps };
    for (const opened of to) {
      // Only in order: a live frame sent ahead of the replay leaves the hole below it to replay.
      if (message.type === 'relay' && message.seq === opened.next) opened.next += 1;
      opened.tab.send(frame);
    }
  }

  /** The Runner back: each tab that follows a Session gets its replay, from what it was not sent. */
  private replayAll(pilotId: string): void {
    for (const [sessionId, followers] of this.opened.get(pilotId) ?? []) {
      for (const { tab, next } of followers.values()) {
        try {
          this.commands.send(pilotId, { type: 'session.replay', sessionId, tabId: tab.tabId, fromSeq: next });
        } catch (error) {
          this.logger.warn({ err: error, sessionId }, 'session replay not sent');
        }
      }
    }
  }
}
