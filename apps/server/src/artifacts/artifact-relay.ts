import { ARTIFACT_TIMEOUT_SECONDS, type ArtifactErrorCode, type RunnerMessageOf } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { COMMAND_RUN_OWNERS, type CommandRunOwners } from '../commands/command-runs.service.js';
import { AppError } from '../errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type TabMessage, type TabSocket, WS_TABS, type WsTabHandlers } from '../realtime/ws-tabs.js';
import { RunnerCommands } from '../runners/runner-commands.service.js';
import { RunnerDispatcher } from '../runners/runner-dispatcher.js';
import { runInPilotScope } from '../scope/scope.context.js';

type Read = Extract<TabMessage, { type: 'artifact.read' }>;

/** A read sent to the Runner, waiting for its answer. */
interface Pending {
  readonly tab: TabSocket;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * The relay of an artefact read in the page (SOURCE-4, ADR 0012 « Reading
 * content in the page », `docs/security/e2e.md` « Contenu lu par la page »):
 * beside `SessionRelay`, by the same rules. The Runner seals its answer for
 * the Appareil that asked; this server reads its ids, keeps the pending
 * request in memory until its answer, writes nothing and logs nothing but its
 * type, `requestId` and `kind`.
 *
 * - `artifact.read` of a tab: the Projet must be its Pilote's (and, for a
 *   `command-output`, the run), else `artifact.not-found` and nothing for the
 *   Runner; a `file` without `at` is read at the Projet's integration branch;
 *   to the Runner with the tab's `tabId`, else `artifact.runner-offline` at
 *   once. No answer in `ARTIFACT_TIMEOUT_SECONDS`: `artifact.timeout`.
 * - `artifact.content` and `artifact.error` of the Runner: to the tab that
 *   asked, without its `tabId`, once; an answer for no pending request (late,
 *   another Pilote's Runner, a closed tab) is dropped.
 */
@Injectable()
export class ArtifactRelay implements OnModuleInit, OnModuleDestroy {
  /** `<tabId>:<requestId>` → the read waiting for the Runner. */
  private readonly pending = new Map<string, Pending>();
  private readonly closedTabs = new WeakSet<TabSocket>();

  constructor(
    @Inject(WS_TABS) private readonly tabs: WsTabHandlers,
    private readonly prisma: PrismaService,
    private readonly commands: RunnerCommands,
    private readonly dispatcher: RunnerDispatcher,
    @Inject(COMMAND_RUN_OWNERS) private readonly owners: CommandRunOwners,
    @InjectPinoLogger(ArtifactRelay.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.tabs.add({
      types: ['artifact.read'],
      handle: (tab, message) => {
        this.read(tab, message as Read).catch((error: unknown) => {
          this.logger.error({ err: error, requestId: (message as Read).requestId }, 'artifact relay failed');
        });
      },
      closed: (tab) => this.forgetTab(tab),
    });
    this.dispatcher.registerRunnerHandler('artifact.content', (message, context) => this.fromRunner(context.pilotId, message));
    this.dispatcher.registerRunnerHandler('artifact.error', (message, context) => this.fromRunner(context.pilotId, message));
  }

  onModuleDestroy(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private async read(tab: TabSocket, { requestId, projectId, holderId, kind, ref }: Read): Promise<void> {
    if (this.closedTabs.has(tab)) return;
    this.logger.debug({ direction: 'in', type: 'artifact.read', requestId, kind }, 'artifact relay');
    const project = await runInPilotScope(tab.pilotId, () =>
      this.prisma.scoped.project.findUnique({ where: { id: projectId }, select: { integrationBranch: true } }),
    );
    const run = kind === 'command-output' && ref.runId !== undefined ? await this.owners.owns(tab.pilotId, ref.runId) : true;
    if (project === null || !run) return this.refuse(tab, requestId, 'artifact.not-found');
    if (this.closedTabs.has(tab)) return;

    const key = keyOf(tab.tabId, requestId);
    const at = kind === 'file' && ref.at === undefined ? { at: project.integrationBranch } : {};
    try {
      this.commands.send(tab.pilotId, { type: 'artifact.read', requestId, projectId, holderId, kind, ref: { ...ref, ...at }, tabId: tab.tabId });
    } catch (error) {
      if (error instanceof AppError && error.code === 'runner.offline') return this.refuse(tab, requestId, 'artifact.runner-offline');
      throw error;
    }
    const previous = this.pending.get(key);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      if (this.pending.get(key)?.timer !== timer) return;
      this.pending.delete(key);
      this.refuse(tab, requestId, 'artifact.timeout');
    }, ARTIFACT_TIMEOUT_SECONDS * 1000);
    this.pending.set(key, { tab, timer });
  }

  private refuse(tab: TabSocket, requestId: string, code: ArtifactErrorCode): void {
    this.logger.debug({ direction: 'out', type: 'artifact.error', requestId, code }, 'artifact relay');
    tab.send({ type: 'artifact.error', requestId, code });
  }

  private forgetTab(tab: TabSocket): void {
    this.closedTabs.add(tab);
    for (const [key, pending] of this.pending) {
      if (pending.tab !== tab) continue;
      clearTimeout(pending.timer);
      this.pending.delete(key);
    }
  }

  /** The Runner's answer: to the tab that asked, if its read waits and is of this Runner's Pilote. */
  private fromRunner(pilotId: string, message: RunnerMessageOf<'artifact.content'> | RunnerMessageOf<'artifact.error'>): void {
    const key = keyOf(message.tabId, message.requestId);
    const pending = this.pending.get(key);
    const to = pending?.tab.pilotId === pilotId ? pending : undefined;
    this.logger.debug({ direction: 'in', type: message.type, requestId: message.requestId, tabs: to ? 1 : 0 }, 'artifact relay');
    if (!to) return;
    clearTimeout(to.timer);
    this.pending.delete(key);
    to.tab.send(
      message.type === 'artifact.content'
        ? { type: 'artifact.content', requestId: message.requestId, wrap: message.wrap, nonce: message.nonce, ciphertext: message.ciphertext }
        : { type: 'artifact.error', requestId: message.requestId, code: message.code },
    );
  }
}

const keyOf = (tabId: string, requestId: string): string => `${tabId}:${requestId}`;
