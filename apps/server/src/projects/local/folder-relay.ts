import type { RunnerMessageOf } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../../errors/app-error.js';
import { type TabMessage, type TabSocket, WS_TABS, type WsTabHandlers } from '../../realtime/ws-tabs.js';
import { RunnerCommands } from '../../runners/runner-commands.service.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';

/**
 * The relay of a folder's check (PROJET-6, ADR 0012): a tab's `folder.check`,
 * its path sealed under the vault key, goes to the Runner with the tab's
 * `tabId`; the Runner's `folder.checked` to that tab only, of the same
 * Pilote. Nothing is stored, nor logged but the frame's type and
 * `requestId`. Runner offline: `folder.error runner.offline`.
 *
 * Per Pilote, in memory (one server process): the tabs that asked a check,
 * until their socket closes.
 */
@Injectable()
export class FolderRelay implements OnModuleInit {
  /** pilotId → tabId → the tab. */
  private readonly askers = new Map<string, Map<string, TabSocket>>();

  constructor(
    @Inject(WS_TABS) private readonly tabs: WsTabHandlers,
    private readonly commands: RunnerCommands,
    private readonly dispatcher: RunnerDispatcher,
    @InjectPinoLogger(FolderRelay.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.tabs.add({
      types: ['folder.check'],
      handle: (tab, message) => this.fromTab(tab, message),
      closed: (tab) => this.forget(tab),
    });
    this.dispatcher.registerRunnerHandler('folder.checked', (message, context) => this.fromRunner(context.pilotId, message));
  }

  private fromTab(tab: TabSocket, message: TabMessage): void {
    if (message.type !== 'folder.check') return;
    const { requestId, sealed } = message;
    this.logger.debug({ direction: 'in', type: message.type, requestId }, 'folder relay');
    const askers = this.askers.get(tab.pilotId) ?? new Map<string, TabSocket>();
    askers.set(tab.tabId, tab);
    this.askers.set(tab.pilotId, askers);
    try {
      this.commands.send(tab.pilotId, { type: 'folder.check', requestId, tabId: tab.tabId, sealed });
    } catch (error) {
      if (error instanceof AppError && error.code === 'runner.offline') return tab.send({ type: 'folder.error', requestId, code: 'runner.offline' });
      this.logger.error({ err: error, requestId }, 'folder relay failed');
    }
  }

  private fromRunner(pilotId: string, { type, requestId, tabId, sealed }: RunnerMessageOf<'folder.checked'>): void {
    const tab = this.askers.get(pilotId)?.get(tabId);
    this.logger.debug({ direction: 'in', type, requestId, tabs: tab ? 1 : 0 }, 'folder relay');
    tab?.send({ type: 'folder.checked', requestId, sealed });
  }

  private forget(tab: TabSocket): void {
    const askers = this.askers.get(tab.pilotId);
    askers?.delete(tab.tabId);
    if (askers?.size === 0) this.askers.delete(tab.pilotId);
  }
}
