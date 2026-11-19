import type { CommandRelayError, RunnerMessageOf, ServerMessage } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../../errors/app-error.js';
import { type TabMessage, type TabSocket, WS_TABS, type WsTabHandlers } from '../../realtime/ws-tabs.js';
import { RunnerCommands } from '../../runners/runner-commands.service.js';
import { type OutgoingRunnerMessage, RunnerConnections } from '../../runners/runner-connections.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';
import { COMMAND_RUN_OWNERS, type CommandRunOwners } from '../command-runs.service.js';

/** A tab that follows a run, and the first `seq` it has not been sent with every one before it. */
interface Opened {
  readonly tab: TabSocket;
  next: number;
}

type CommandTabMessage = Extract<TabMessage, { type: 'command.open' | 'command.close' }>;

/**
 * The relay of a run's output (RUNNER-18, ADR 0003 and 0013,
 * `docs/security/e2e.md` « Commandes »), the Session's relay to the letter:
 * the chunks, sealed by the Runner under the run's key, go to the tabs
 * through this server, which reads their ids and `seq`, keeps none of them,
 * never writes nor logs them.
 *
 * - `command.open` of a tab: the run must be its Pilote's
 *   (`COMMAND_RUN_OWNERS`), else `command.error command.not-found`; the tab
 *   then follows it, and the Runner is asked for its replay to the tab
 *   (`command.replay`). Runner offline: `command.error
 *   command.runner-offline`, the tab still follows it, and its replay is
 *   asked once the Runner's `hello` is accepted.
 * - `command.close`, or the tab's socket closed: it stops following it.
 * - `command.keys` and `command.output` of the Runner: to the tab of their
 *   `tabId`, else to every tab that follows the run; a Pilote's other tabs
 *   get nothing.
 *
 * Per Pilote, in memory (one server process). A tab's messages are handled
 * one after the other.
 */
@Injectable()
export class CommandOutputRelay implements OnModuleInit, OnModuleDestroy {
  /** pilotId → runId → tabId → the tab. */
  private readonly opened = new Map<string, Map<string, Map<string, Opened>>>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly closedTabs = new WeakSet<TabSocket>();
  private readonly removals: (() => void)[] = [];

  constructor(
    @Inject(WS_TABS) private readonly tabs: WsTabHandlers,
    @Inject(COMMAND_RUN_OWNERS) private readonly owners: CommandRunOwners,
    private readonly commands: RunnerCommands,
    private readonly connections: RunnerConnections,
    private readonly dispatcher: RunnerDispatcher,
    @InjectPinoLogger(CommandOutputRelay.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.tabs.add({
      types: ['command.open', 'command.close'],
      handle: (tab, message) => this.serial(tab, () => this.fromTab(tab, message as CommandTabMessage)),
      closed: (tab) => this.forgetTab(tab),
    });
    this.dispatcher.registerRunnerHandler('command.keys', (message, context) => this.fromRunner(context.pilotId, message));
    this.dispatcher.registerRunnerHandler('command.output', (message, context) => this.fromRunner(context.pilotId, message));
    this.removals.push(this.connections.onAccepted((link) => this.replayAll(link.pilotId)));
  }

  onModuleDestroy(): void {
    for (const remove of this.removals.splice(0)) remove();
  }

  private serial(tab: TabSocket, fn: () => Promise<void>): void {
    const next = (this.queues.get(tab.tabId) ?? Promise.resolve()).then(fn).catch((error: unknown) => {
      this.logger.error({ err: error, tabId: tab.tabId }, 'command relay failed');
    });
    this.queues.set(tab.tabId, next);
    void next.then(() => {
      if (this.queues.get(tab.tabId) === next) this.queues.delete(tab.tabId);
    });
  }

  private async fromTab(tab: TabSocket, message: CommandTabMessage): Promise<void> {
    if (this.closedTabs.has(tab)) return;
    this.logger.debug({ direction: 'in', type: message.type, runId: message.runId }, 'command relay');
    if (message.type === 'command.close') return this.unfollow(tab, message.runId);
    const { runId, fromSeq } = message;
    if (!(await this.owners.owns(tab.pilotId, runId))) return this.refuse(tab, runId, 'command.not-found');
    if (this.closedTabs.has(tab)) return;
    this.follow(tab, runId, fromSeq);
    this.toRunner(tab, { type: 'command.replay', runId, tabId: tab.tabId, fromSeq });
  }

  private toRunner(tab: TabSocket, message: OutgoingRunnerMessage & { runId: string }): void {
    try {
      this.commands.send(tab.pilotId, message);
    } catch (error) {
      if (error instanceof AppError && error.code === 'runner.offline') return this.refuse(tab, message.runId, 'command.runner-offline');
      throw error;
    }
  }

  private refuse(tab: TabSocket, runId: string, code: CommandRelayError): void {
    tab.send({ type: 'command.error', runId, code });
  }

  private follow(tab: TabSocket, runId: string, fromSeq: number): void {
    const runs = this.opened.get(tab.pilotId) ?? new Map<string, Map<string, Opened>>();
    const followers = runs.get(runId) ?? new Map<string, Opened>();
    followers.set(tab.tabId, { tab, next: fromSeq });
    runs.set(runId, followers);
    this.opened.set(tab.pilotId, runs);
  }

  private unfollow(tab: TabSocket, runId: string): void {
    const runs = this.opened.get(tab.pilotId);
    const followers = runs?.get(runId);
    followers?.delete(tab.tabId);
    if (followers?.size === 0) runs?.delete(runId);
    if (runs?.size === 0) this.opened.delete(tab.pilotId);
  }

  private forgetTab(tab: TabSocket): void {
    this.closedTabs.add(tab);
    for (const runId of [...(this.opened.get(tab.pilotId)?.keys() ?? [])]) this.unfollow(tab, runId);
  }

  /** A frame of the Runner: to the tab of its `tabId` if it follows the run, else to every tab that does. */
  private fromRunner(pilotId: string, message: RunnerMessageOf<'command.keys'> | RunnerMessageOf<'command.output'>): void {
    const followers = this.opened.get(pilotId)?.get(message.runId);
    const to = message.tabId === undefined ? [...(followers?.values() ?? [])] : [followers?.get(message.tabId)].filter((opened) => opened !== undefined);
    this.logger.debug({ direction: 'in', type: message.type, runId: message.runId, tabs: to.length }, 'command relay');
    const frame: ServerMessage =
      message.type === 'command.output'
        ? { type: 'command.output', runId: message.runId, seq: message.seq, nonce: message.nonce, ciphertext: message.ciphertext }
        : { type: 'command.keys', runId: message.runId, wraps: message.wraps };
    for (const opened of to) {
      // Only in order: a live frame sent ahead of the replay leaves the hole below it to replay.
      if (message.type === 'command.output' && message.seq === opened.next) opened.next += 1;
      opened.tab.send(frame);
    }
  }

  /** The Runner back: each tab that follows a run gets its replay, from what it was not sent. */
  private replayAll(pilotId: string): void {
    for (const [runId, followers] of this.opened.get(pilotId) ?? []) {
      for (const { tab, next } of followers.values()) {
        try {
          this.commands.send(pilotId, { type: 'command.replay', runId, tabId: tab.tabId, fromSeq: next });
        } catch (error) {
          this.logger.warn({ err: error, runId }, 'command replay not sent');
        }
      }
    }
  }
}
