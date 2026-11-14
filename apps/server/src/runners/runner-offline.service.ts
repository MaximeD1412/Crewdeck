import type { WaitingProject } from '@crewdeck/contracts';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DecisionsService, type RaiseInput } from '../decisions/decisions.service.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { RunnerPresence } from './runner-presence.service.js';
import { RunnerWaitingWork } from './waiting-work.js';

/** The outcome of the Décision once the Runner is back online. */
export const RUNNER_BACK = 'runner-back';

/** The outcome of the Décision of a Runner revoked by the link of another. */
export const RUNNER_REPLACED = 'runner-replaced';

const projectsCount = (count: number): string => (count === 1 ? '1 Projet' : `${count} Projets`);

/**
 * The « Runner hors ligne » Décision of `runner` (US-19): one per Runner,
 * halt, its Projets counted, since its last heartbeat (`params.since`), the
 * Projets as JSON (`params.projects`, `parseWaitingProjects`), leading to
 * `/runner`. Readable state only (ADR 0003): Projets' names, numbers, counts.
 */
export const runnerOfflineDecision = (runner: { id: string; lastSeenAt: Date }, projects: readonly WaitingProject[]): RaiseInput => ({
  kind: 'runner-offline',
  projectId: null,
  projectName: null,
  subjectType: 'runner',
  subjectId: runner.id,
  label: `Le travail attend dans ${projectsCount(projects.length)}`,
  metaParts: [projectsCount(projects.length)],
  tone: 'halt',
  link: '/runner',
  params: { since: runner.lastSeenAt.toISOString(), projects: JSON.stringify(projects) },
});

/**
 * « Runner hors ligne » (ATOI-3): when a Pilote's Runner goes offline while
 * work waits for it (`RunnerWaitingWork`), one Décision lists the Projets
 * whose work waits; `refresh` updates it (never a second one) when new work
 * starts waiting while the Runner is still offline; the Runner back online
 * resolves it. Nothing waiting, no Décision: the Cadre still says « hors
 * ligne ». A Runner replaced by a new link takes its Décision with it
 * (`resolveReplaced`): the new one raises its own.
 *
 * Each sync reads the Runner's row as committed and brings the Décision to
 * it, one sync after the other per Pilote: the presence's hooks fire after
 * each change, so the last sync sees the last state.
 */
@Injectable()
export class RunnerOffline implements OnModuleInit, OnModuleDestroy {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly removals: (() => void)[] = [];

  constructor(
    private readonly presence: RunnerPresence,
    private readonly transactions: Transactions,
    private readonly decisions: DecisionsService,
    private readonly work: RunnerWaitingWork,
    private readonly events: EventsWriter,
    @InjectPinoLogger(RunnerOffline.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    const sync = (pilotId: string) => {
      this.refresh(pilotId).catch((error: unknown) => this.logger.error({ err: error }, 'runner offline sync failed'));
    };
    this.removals.push(this.presence.onAnyOffline(sync), this.presence.onAnyOnline(sync));
  }

  onModuleDestroy(): void {
    for (const remove of this.removals.splice(0)) remove();
  }

  /**
   * Brings `pilotId`'s « Runner hors ligne » to the current state: their
   * Runner offline with work waiting, the Décision raised or updated with
   * every Projet; online, resolved (`runner-back`). A module calls it when
   * new work starts waiting while the Runner may be offline.
   */
  refresh(pilotId: string): Promise<void> {
    const previous = this.queues.get(pilotId) ?? Promise.resolve();
    const run = previous.then(() => runInPilotScope(pilotId, () => this.sync(pilotId)));
    const settled = run.catch(() => undefined);
    this.queues.set(pilotId, settled);
    void settled.then(() => {
      if (this.queues.get(pilotId) === settled) this.queues.delete(pilotId);
    });
    return run;
  }

  /**
   * Resolves, in `tx` and the Pilote's scope, the open « Runner hors ligne »
   * of every Runner but `currentRunnerId` (`runner-replaced`): those of the
   * Runners a new link revoked. `RunnerLinks.confirm` calls it in its
   * transaction; each sync too.
   */
  async resolveReplaced(tx: Tx, currentRunnerId: string | null): Promise<void> {
    const replaced = await tx.decision.findMany({
      where: { kind: 'runner-offline', state: 'open', ...(currentRunnerId === null ? {} : { subjectId: { not: currentRunnerId } }) },
      select: { subjectId: true },
    });
    for (const { subjectId } of replaced) await this.decisions.resolve(tx, 'runner-offline', subjectId, RUNNER_REPLACED);
  }

  private async sync(pilotId: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      // The Pilote's row first, as RunnerLinks.confirm (its event, then `resolveReplaced`): never a deadlock between them.
      await this.events.lock(tx, pilotId);
      const runner = await tx.runner.findFirst({ where: { revokedAt: null }, select: { id: true, state: true, lastSeenAt: true } });
      await this.resolveReplaced(tx, runner?.id ?? null);
      if (!runner) return;
      if (runner.state === 'online') {
        await this.decisions.resolve(tx, 'runner-offline', runner.id, RUNNER_BACK);
        return;
      }
      const projects = await this.work.collect(pilotId);
      if (projects.length > 0) await this.decisions.raise(tx, runnerOfflineDecision(runner, projects));
    });
  }
}
