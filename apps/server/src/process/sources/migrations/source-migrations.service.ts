import {
  groupsOfPhase,
  type MigrateSourceInput,
  type MigrationFingerprint,
  type MigrationSwitch,
  RUNNING_SOURCE_MIGRATION_STATES,
  SOURCE_MIGRATION_WAITING_ITEMS_MAX,
  type SourceGroup,
  type SourceKind,
  type SourceMigration,
  type SourceMigrationPage,
  type SourceMigrationQuery,
  type SourceMigrationWaitingItem,
} from '@crewdeck/contracts';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DecisionsService } from '../../../decisions/decisions.service.js';
import { AppError, notFound, unprocessable } from '../../../errors/app-error.js';
import { MESSAGES } from '../../../errors/messages.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { newId } from '../../../ids.js';
import { EventsWriter } from '../../../realtime/events.writer.js';
import { assertFresh } from '../../../realtime/freshness.js';
import { afterCommit, Transactions, type Tx } from '../../../realtime/transactions.js';
import { RunnerClock } from '../../../runners/clock.js';
import { type OutgoingRunnerMessage, type RunnerLink, RunnerConnections } from '../../../runners/runner-connections.js';
import { RunnerCommands } from '../../../runners/runner-commands.service.js';
import { RunnerDispatcher } from '../../../runners/runner-dispatcher.js';
import { RunnerPresence } from '../../../runners/runner-presence.service.js';
import { currentPilotId, runInPilotScope } from '../../../scope/scope.context.js';
import { SensitiveActionsService } from '../../../sensitive-actions/sensitive-actions.service.js';
import { Engine } from '../../engine/engine.js';
import { readProjectProcess } from '../../process.service.js';
import { toProject, PROJECT_VIEW } from '../../../projects/project.view.js';
import { decodeMigrationCursor, encodeMigrationCursor } from './migration-cursor.js';
import { SOURCE_MIGRATION_VIEW, type SourceMigrationRow, toSourceMigration, waitingItemsOf } from './source-migration.view.js';

/** What the switch carries to a hook: the Runner's fingerprints and new numbers, empty for a group that held nothing. */
export type SwitchMessage = Pick<MigrationSwitch, 'fingerprints' | 'renumbering'>;

/**
 * What a group adds to the switch, in its transaction (SOURCE-8: the
 * Tickets' new numbers; SOURCE-9: the code's place): it writes its rows and
 * their events with `tx`; a throw rolls the whole switch back.
 */
export type SwitchHook = (tx: Tx, migration: SourceMigration, message: SwitchMessage) => Promise<void>;

/** The code of a migration whose switch a hook refused: it stays on the old Source. */
export const SWITCH_FAILED = 'source-migration.switch-failed';
/** The code of a migration the connected Runner cannot copy (its `hello.migrations` lacks the group). */
export const RUNNER_CANNOT_MIGRATE = 'source-migration.runner-cannot-migrate';

/** The delays before `migration.finish` is sent again, after the 1st, 2nd, 3rd failure, then each one: 1, 5, 15, then 60 minutes. */
export const FINISH_RETRY_MINUTES = [1, 5, 15, 60] as const;
/** At this failure of finishing, the Décision `source-migration.unfinished` is raised. */
export const UNFINISHED_AFTER_FAILURES = 3;

const GROUP_LABEL: Readonly<Record<SourceGroup, string>> = { ticket: 'Ticket', code: 'Changement de code' };
/** The old place not yet frozen, by group and old Source (ADR 0012, « Frozen means, by group »). */
const OLD_PLACE: Readonly<Record<SourceGroup, Readonly<Record<'local' | 'github', string>>>> = {
  ticket: { local: 'tickets/ pas encore archivé', github: 'issues pas encore archivées' },
  code: { local: 'dossier pas encore figé', github: 'dépôt pas encore figé' },
};

const LABEL_MAX = 120;
const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const migrationNotFound = (): AppError => notFound('source-migration.not-found', MESSAGES['source-migration.not-found']);
const projectNotFound = (): AppError => notFound('project.not-found', MESSAGES['project.not-found']);

const sameItems = (a: readonly SourceMigrationWaitingItem[], b: readonly SourceMigrationWaitingItem[]): boolean =>
  a.length === b.length && a.every((item, index) => item.itemType === b[index]?.itemType && item.number === b[index]?.number);

/** A Décision's label: the group « de » the Projet, the group alone for a Local Projet (its name sealed). */
const labelOf = (group: SourceGroup, projectName: string | null): string =>
  projectName === null ? GROUP_LABEL[group] : cut(`${GROUP_LABEL[group]} de ${projectName}`, LABEL_MAX);

interface MigratingProject {
  readonly id: string;
  /** `null` for a Local Projet (PROJET-6): its name is sealed, the page names it. */
  readonly displayName: string | null;
  readonly owner: string | null;
  readonly name: string | null;
  readonly hasCode: boolean;
}

/**
 * Moving a Type d'artefact to another Source (US-102, ADR 0012, « Moving a
 * Source »): the Action sensible `source.migrate` creates the migration
 * `draining`; no new work of the group starts (the Engine holds it, on
 * `source-migration`) while the work in progress finishes on the old
 * Source; then the Runner copies and verifies, and the switch moves the
 * group in one transaction. A failure before it leaves the old Source;
 * after it, finishing is retried until the old place is frozen.
 */
@Injectable()
export class SourceMigrations implements OnModuleInit, OnModuleDestroy {
  /** The groups each accepted Runner said it can copy (`hello.migrations`), kept with its socket. */
  private readonly capable = new WeakMap<RunnerLink, readonly SourceGroup[]>();
  private readonly hooks = new Map<SourceGroup, SwitchHook[]>();
  private readonly pending = new Set<Promise<void>>();
  private readonly removals: (() => void)[] = [];

  constructor(
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly decisions: DecisionsService,
    private readonly engine: Engine,
    private readonly sensitive: SensitiveActionsService,
    private readonly dispatcher: RunnerDispatcher,
    private readonly connections: RunnerConnections,
    private readonly commands: RunnerCommands,
    private readonly presence: RunnerPresence,
    private readonly clock: RunnerClock,
    @InjectPinoLogger(SourceMigrations.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('migration.progress', (message) => this.progress(message.migrationId, message));
    this.dispatcher.registerRunnerHandler('migration.switch', (message) => this.switched(message.migrationId, message));
    this.dispatcher.registerRunnerHandler('migration.finished', (message) => this.finished(message.migrationId));
    this.dispatcher.registerRunnerHandler('migration.failed', (message) => this.failed(message.migrationId, message.stage, message.code));
    this.removals.push(
      this.engine.onPhaseRunEnded(async (tx, { projectId }) => {
        const draining = await tx.sourceMigration.findFirst({ where: { projectId, state: 'draining' }, select: { id: true } });
        if (draining) this.later(tx, currentPilotId(), draining.id);
      }),
      this.connections.onAccepted((link, hello) => {
        this.capable.set(link, hello.migrations ?? []);
        this.track(runInPilotScope(link.pilotId, () => this.reconnected(link)));
      }),
    );
  }

  onModuleDestroy(): void {
    for (const remove of this.removals.splice(0)) remove();
  }

  /** For SOURCE-8 and SOURCE-9, in their `onModuleInit`: `hook` runs in each switch of `group`. */
  registerSwitchHook(group: SourceGroup, hook: SwitchHook): void {
    this.hooks.set(group, [...(this.hooks.get(group) ?? []), hook]);
  }

  /**
   * The drain check of `id`, from the sweep: a migration left `draining`
   * by a restart (its check lived in memory only) goes on.
   */
  resumeDrain(id: string): Promise<void> {
    return this.drain(currentPilotId(), id);
  }

  /** Once every drain, message and resend started so far is done: for the tests. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /**
   * `source.migrate` of the Projet's `group` to `to`: the migration
   * `draining` and its event, the older `failed` one's Décision resolved
   * `replaced`; then, once committed, the drain check. 404 another
   * Pilote's Projet, 409 a `seq` older than the Projet's, 422 for a group
   * already there, a migration running, a target without a place, a
   * Runner online that cannot copy what the group holds.
   */
  migrate(projectId: string, group: SourceGroup, { to, seq }: MigrateSourceInput): Promise<SourceMigration> {
    const pilotId = currentPilotId();
    return this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      const project = await tx.project.findFirst({ where: { id: projectId }, select: { id: true, lastSeq: true, accessLost: true, hasCode: true, repositoryId: true } });
      if (!project) throw projectNotFound();
      this.sensitive.assertFresh(project.lastSeq, BigInt(seq));
      const source = await tx.artifactSource.findFirstOrThrow({ where: { projectId, group }, select: { source: true } });
      if (source.source === to) throw unprocessable('source.same', MESSAGES['source.same']);
      const running = await tx.sourceMigration.count({ where: { projectId, state: { in: [...RUNNING_SOURCE_MIGRATION_STATES] } } });
      if (running > 0) throw unprocessable('source.migration-running', MESSAGES['source.migration-running']);
      if (!(await this.hasPlace(tx, projectId, to, project.repositoryId === null || project.accessLost))) throw unprocessable('source.target-missing', MESSAGES['source.target-missing']);
      if ((await this.holdsSomething(tx, projectId, group, project.hasCode)) && this.runnerLacks(pilotId, group)) {
        throw unprocessable('source.runner-cannot-migrate', MESSAGES['source.runner-cannot-migrate']);
      }
      for (const old of await tx.sourceMigration.findMany({ where: { projectId, state: 'failed' }, select: { id: true } })) {
        await this.decisions.resolve(tx, 'source-migration.failed', old.id, 'replaced');
      }
      const row = await tx.sourceMigration.create({
        data: { id: newId(), pilotId, projectId, group, from: source.source, to, state: 'draining', waitingItems: await this.waitingItems(tx, projectId, group), createdAt: this.clock.now() },
        select: SOURCE_MIGRATION_VIEW,
      });
      const migration = await this.publish(tx, row);
      this.later(tx, pilotId, row.id);
      return migration;
    });
  }

  /**
   * « Réessayer » of a `failed` migration: `draining` again with `attempt`
   * + 1, its Décision resolved `retried`; the drain check then sends
   * `migration.copy` again (the copy reuses what it finds). 404, 409 on its
   * own `lastSeq`, 422 one that did not fail or a Projet migrating another.
   */
  retry(id: string, seq: bigint): Promise<SourceMigration> {
    const pilotId = currentPilotId();
    return this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      const found = await tx.sourceMigration.findFirst({ where: { id }, select: { state: true, projectId: true, group: true, from: true, createdAt: true, lastSeq: true } });
      if (!found) throw migrationNotFound();
      assertFresh(found.lastSeq, seq);
      if (found.state !== 'failed') throw unprocessable('source-migration.not-failed', MESSAGES['source-migration.not-failed']);
      // A newer migration of the Projet replaced it, or its group left its old Source since: copying from there would undo what is now true.
      const newer = await tx.sourceMigration.count({ where: { projectId: found.projectId, id: { not: id }, createdAt: { gte: found.createdAt } } });
      const source = await tx.artifactSource.findFirstOrThrow({ where: { projectId: found.projectId, group: found.group }, select: { source: true } });
      if (newer > 0 || source.source !== found.from) throw unprocessable('source-migration.replaced', MESSAGES['source-migration.replaced']);
      const running = await tx.sourceMigration.count({ where: { projectId: found.projectId, state: { in: [...RUNNING_SOURCE_MIGRATION_STATES] } } });
      if (running > 0) throw unprocessable('source.migration-running', MESSAGES['source.migration-running']);
      await this.decisions.resolve(tx, 'source-migration.failed', id, 'retried');
      const row = await tx.sourceMigration.update({
        where: { id },
        data: { state: 'draining', attempt: { increment: 1 }, errorCode: null, endedAt: null, waitingItems: await this.waitingItems(tx, found.projectId, found.group) },
        select: SOURCE_MIGRATION_VIEW,
      });
      const migration = await this.publish(tx, row);
      this.later(tx, pilotId, id);
      return migration;
    });
  }

  /** `GET /api/projects/:id/source-migrations`: the Projet's migrations, the newest first, 50 per page. */
  async list(tx: Pick<Tx, 'project' | 'sourceMigration'>, projectId: string, { cursor, limit, state }: SourceMigrationQuery): Promise<SourceMigrationPage> {
    if ((await tx.project.count({ where: { id: projectId } })) === 0) throw projectNotFound();
    const after = cursor === undefined ? undefined : decodeMigrationCursor(cursor);
    if (cursor !== undefined && !after) throw unprocessable('source-migration.cursor-invalid', MESSAGES['source-migration.cursor-invalid'], { cursor: MESSAGES['source-migration.cursor-invalid'] });
    const rows = await tx.sourceMigration.findMany({
      where: {
        projectId,
        ...(state ? { state } : {}),
        ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SOURCE_MIGRATION_VIEW,
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items: items.map(toSourceMigration), nextCursor: rows.length > limit && last ? encodeMigrationCursor(last) : null };
  }

  /**
   * The drain check of a `draining` migration, in its own transaction: its
   * waiting items updated; none left, a group that holds nothing switches
   * and is `done` at once, else `copying` and `migration.copy` to a
   * Runner connected (one without the group fails it); a hook refusing the
   * switch rolls it back, the migration then `failed` on the old Source.
   */
  private async drain(pilotId: string, id: string): Promise<void> {
    try {
      await this.transactions.run(async (tx) => {
        await this.events.lock(tx, pilotId);
        const row = await tx.sourceMigration.findFirst({ where: { id, state: 'draining' }, select: SOURCE_MIGRATION_VIEW });
        if (!row) return;
        const waiting = await this.waitingItems(tx, row.projectId, row.group);
        if (waiting.length > 0) {
          if (!sameItems(waiting, waitingItemsOf(row.waitingItems))) {
            await this.publish(tx, await tx.sourceMigration.update({ where: { id }, data: { waitingItems: waiting }, select: SOURCE_MIGRATION_VIEW }));
          }
          return;
        }
        const project = await tx.project.findFirstOrThrow({ where: { id: row.projectId }, select: { hasCode: true } });
        if (!(await this.holdsSomething(tx, row.projectId, row.group, project.hasCode))) {
          await this.switchIn(tx, row, { fingerprints: [], renumbering: [] }, 'done');
          return;
        }
        const copying = await tx.sourceMigration.update({ where: { id }, data: { state: 'copying', waitingItems: [] }, select: SOURCE_MIGRATION_VIEW });
        await this.publish(tx, copying);
        const link = this.onlineLink(pilotId);
        if (link && !this.canMigrate(link, row.group)) {
          await this.failIn(tx, copying, RUNNER_CANNOT_MIGRATE);
          return;
        }
        const message = await this.copyMessage(tx, copying);
        afterCommit(tx, () => this.send(pilotId, message));
      });
    } catch (error) {
      this.logger.error({ err: error, migrationId: id }, 'source migration switch failed');
      await this.failAfterRollback(id, ['draining']);
    }
  }

  /** `migration.progress`: the counts and the state (`copying`, `verifying`) of a migration still copying. */
  private progress(id: string, { total, copied, state }: { total: number; copied: number; state: 'copying' | 'verifying' }): Promise<void> {
    return this.transactions.run(async (tx) => {
      const [row] = await tx.sourceMigration.updateManyAndReturn({ where: { id, state: { in: ['copying', 'verifying'] } }, data: { total, copied, state }, select: SOURCE_MIGRATION_VIEW });
      if (row) await this.publish(tx, row);
    });
  }

  /**
   * `migration.switch`, the point of no return: the switch in one
   * transaction, then `migration.finish`. A hook that throws rolls it back
   * whole; the migration is then `failed` (`switch-failed`) on the old
   * Source.
   */
  private async switched(id: string, message: SwitchMessage): Promise<void> {
    const pilotId = currentPilotId();
    try {
      await this.transactions.run(async (tx) => {
        await this.events.lock(tx, pilotId);
        const row = await tx.sourceMigration.findFirst({ where: { id, state: { in: ['copying', 'verifying'] } }, select: SOURCE_MIGRATION_VIEW });
        if (!row) return;
        await this.switchIn(tx, row, message, 'switched');
        afterCommit(tx, () => this.send(pilotId, { type: 'migration.finish', migrationId: id, fingerprints: message.fingerprints }));
      });
    } catch (error) {
      this.logger.error({ err: error, migrationId: id }, 'source migration switch failed');
      await this.failAfterRollback(id, ['copying', 'verifying']);
    }
  }

  /** `migration.finished`: the old place frozen, `done`; the Décision `unfinished` resolved, the held work started on the new Source. */
  private finished(id: string): Promise<void> {
    return this.transactions.run(async (tx) => {
      const [row] = await tx.sourceMigration.updateManyAndReturn({
        where: { id, state: 'switched' },
        data: { state: 'done', endedAt: this.clock.now(), nextFinishAt: null },
        select: SOURCE_MIGRATION_VIEW,
      });
      if (!row) return;
      await this.publish(tx, row);
      await this.decisions.resolve(tx, 'source-migration.unfinished', id, 'finished');
      await this.engine.releaseHeld(tx, row.projectId);
    });
  }

  /**
   * `migration.failed`: before the switch (`copy`), `failed` on the old
   * Source with its Décision, the held work released; after it
   * (`finish`), still `switched`, `migration.finish` due again after 1, 5,
   * 15, then 60 minutes, the Décision `unfinished` at the third failure.
   */
  private failed(id: string, stage: 'copy' | 'finish', code: string): Promise<void> {
    return this.transactions.run(async (tx) => {
      await this.events.lock(tx, currentPilotId());
      if (stage === 'copy') {
        const row = await tx.sourceMigration.findFirst({ where: { id, state: { in: ['copying', 'verifying'] } }, select: SOURCE_MIGRATION_VIEW });
        if (row) await this.failIn(tx, row, code);
        return;
      }
      const found = await tx.sourceMigration.findFirst({ where: { id, state: 'switched' }, select: { finishTries: true } });
      if (!found) return;
      const tries = found.finishTries + 1;
      const minutes = FINISH_RETRY_MINUTES[Math.min(tries, FINISH_RETRY_MINUTES.length) - 1] ?? 60;
      const row = await tx.sourceMigration.update({
        where: { id },
        data: { finishTries: tries, errorCode: code, nextFinishAt: new Date(this.clock.now().getTime() + minutes * 60_000) },
        select: { ...SOURCE_MIGRATION_VIEW, finishTries: true },
      });
      if (tries >= UNFINISHED_AFTER_FAILURES) await this.raiseUnfinished(tx, row);
    });
  }

  /**
   * The finishes due (`switched`, `nextFinishAt` past) of the current
   * Pilote: `migration.finish` sent again to a Runner online, the next due
   * when it fails again; none online, the next `hello` sends it.
   */
  async resendDueFinishes(now: Date): Promise<number> {
    const pilotId = currentPilotId();
    const link = this.onlineLink(pilotId);
    if (!link) return 0;
    return this.transactions.run(async (tx) => {
      const due = await tx.sourceMigration.findMany({ where: { state: 'switched', nextFinishAt: { lte: now } }, select: { id: true, fingerprints: true } });
      for (const row of due) {
        await tx.sourceMigration.update({ where: { id: row.id }, data: { nextFinishAt: null } });
        const message: OutgoingRunnerMessage = { type: 'migration.finish', migrationId: row.id, fingerprints: row.fingerprints as MigrationFingerprint[] };
        afterCommit(tx, () => this.send(pilotId, message));
      }
      return due.length;
    });
  }

  /**
   * A Runner whose `hello` was accepted: each migration copying or
   * verifying gets `migration.copy` again (or fails, when the Runner
   * cannot copy its group), each `switched` one `migration.finish`.
   */
  private async reconnected(link: RunnerLink): Promise<void> {
    const pilotId = link.pilotId;
    await this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      const rows = await tx.sourceMigration.findMany({ where: { state: { in: ['copying', 'verifying', 'switched'] } }, select: { ...SOURCE_MIGRATION_VIEW, fingerprints: true } });
      for (const row of rows) {
        if (row.state === 'switched') {
          await tx.sourceMigration.update({ where: { id: row.id }, data: { nextFinishAt: null } });
          const message: OutgoingRunnerMessage = { type: 'migration.finish', migrationId: row.id, fingerprints: row.fingerprints as MigrationFingerprint[] };
          afterCommit(tx, () => this.send(pilotId, message));
        } else if (!this.canMigrate(link, row.group)) {
          await this.failIn(tx, row, RUNNER_CANNOT_MIGRATE);
        } else {
          const message = await this.copyMessage(tx, row);
          afterCommit(tx, () => this.send(pilotId, message));
        }
      }
    });
  }

  /**
   * The switch, in `tx`: the group's Source since now, the migration
   * `state` (`switched`, or `done` for a group that held nothing), its
   * fingerprints, the group's hooks; the events of the migration, the
   * Process's view and the Projet; for `done`, the held work then starts
   * on the new Source.
   */
  private async switchIn(tx: Tx, row: SourceMigrationRow, message: SwitchMessage, state: 'switched' | 'done'): Promise<void> {
    const pilotId = currentPilotId();
    const now = this.clock.now();
    await tx.artifactSource.updateMany({ where: { projectId: row.projectId, group: row.group }, data: { source: row.to, since: now } });
    const updated = await tx.sourceMigration.update({
      where: { id: row.id },
      data: {
        state,
        switchedAt: now,
        endedAt: state === 'done' ? now : null,
        waitingItems: [],
        fingerprints: message.fingerprints as unknown as Prisma.InputJsonValue,
      },
      select: SOURCE_MIGRATION_VIEW,
    });
    const migration = toSourceMigration(updated);
    for (const hook of this.hooks.get(row.group) ?? []) await hook(tx, migration, message);
    await this.publish(tx, updated);
    await this.events.write(tx, pilotId, 'process.upserted', await readProjectProcess(tx, row.projectId));
    const project = toProject(await tx.project.findUniqueOrThrow({ where: { id: row.projectId }, select: PROJECT_VIEW }));
    const projectSeq = await this.events.write(tx, pilotId, 'project.upserted', project);
    await tx.project.update({ where: { id: row.projectId }, data: { lastSeq: projectSeq } });
    // `switched` still holds the group's new work until the old place is frozen (`migration.finished`).
    if (state === 'done') await this.engine.releaseHeld(tx, row.projectId);
  }

  /** `failed` with `code`, on the old Source: its Décision raised, the held work released. */
  private async failIn(tx: Tx, row: SourceMigrationRow, code: string): Promise<void> {
    const updated = await tx.sourceMigration.update({
      where: { id: row.id },
      data: { state: 'failed', errorCode: code, endedAt: this.clock.now(), waitingItems: [] },
      select: SOURCE_MIGRATION_VIEW,
    });
    await this.publish(tx, updated);
    const project = await this.projectOf(tx, row.projectId);
    await this.decisions.raise(tx, {
      kind: 'source-migration.failed',
      projectId: project.id,
      projectName: project.displayName,
      subjectType: 'source-migration',
      subjectId: row.id,
      label: labelOf(row.group, project.displayName),
      metaParts: ['Sources'],
      tone: 'halt',
      link: `/projets/${project.id}/process?onglet=sources`,
      params: { migrationId: row.id, group: row.group, from: row.from, to: row.to, code },
    });
    await this.engine.releaseHeld(tx, row.projectId);
  }

  /** After a switch rolled back: the migration, still in one of `states`, `failed` with `switch-failed`. */
  private async failAfterRollback(id: string, states: readonly ('draining' | 'copying' | 'verifying')[]): Promise<void> {
    await this.transactions.run(async (tx) => {
      await this.events.lock(tx, currentPilotId());
      const row = await tx.sourceMigration.findFirst({ where: { id, state: { in: [...states] } }, select: SOURCE_MIGRATION_VIEW });
      if (row) await this.failIn(tx, row, SWITCH_FAILED);
    });
  }

  private async raiseUnfinished(tx: Tx, row: SourceMigrationRow): Promise<void> {
    const project = await this.projectOf(tx, row.projectId);
    await this.decisions.raise(tx, {
      kind: 'source-migration.unfinished',
      projectId: project.id,
      projectName: project.displayName,
      subjectType: 'source-migration',
      subjectId: row.id,
      label: labelOf(row.group, project.displayName),
      metaParts: [OLD_PLACE[row.group][row.from]],
      tone: 'caution',
      link: `/projets/${project.id}/process?onglet=sources`,
      params: { migrationId: row.id, group: row.group, from: row.from, to: row.to },
    });
  }

  /**
   * The work of the Projet that touches `group` and holds its old Source:
   * each PhaseRun `running` or `waiting` (on the Pilote included), but not
   * one waiting for its turn or held by the migration itself, whose Phase
   * reads or writes the group; the oldest first, 50 at most.
   */
  private async waitingItems(tx: Tx, projectId: string, group: SourceGroup): Promise<SourceMigrationWaitingItem[]> {
    const rows = await tx.phaseRun.findMany({
      where: { projectId, state: { in: ['running', 'waiting'] }, OR: [{ waitingOn: null }, { waitingOn: { notIn: ['queue', 'source-migration'] } }] },
      select: { phaseId: true, itemType: true, itemId: true, processVersionId: true, builtinTemplate: true },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
    const items: SourceMigrationWaitingItem[] = [];
    for (const row of rows) {
      if (!groupsOfPhase(await this.engine.definitionFor(tx, row), row.phaseId).includes(group)) continue;
      const number = row.itemType === 'ticket' && /^[1-9]\d*$/.test(row.itemId) ? Number(row.itemId) : undefined;
      items.push(number === undefined ? { itemType: row.itemType as SourceMigrationWaitingItem['itemType'] } : { itemType: 'ticket', number });
      if (items.length === SOURCE_MIGRATION_WAITING_ITEMS_MAX) break;
    }
    return items;
  }

  /**
   * Whether `to` has a place for the group: GitHub, the Projet's Dépôt
   * (PROJET-2) while its access holds, none for a Local Projet (PROJET-6); Local, the Projet's folder on the
   * Runner's machine, declared once one of its groups is Local (a Local
   * Projet, or Tickets in its `tickets/`), and still there once that group
   * left it: a migration from Local only archives its sub-folder (ADR 0012),
   * so its row proves the folder. The Runner's clone of a GitHub Projet is
   * not one; SOURCE-9 lets the Pilote pick a folder.
   */
  private async hasPlace(tx: Pick<Tx, 'artifactSource' | 'sourceMigration'>, projectId: string, to: SourceKind, noRepository: boolean): Promise<boolean> {
    if (to === 'github') return !noRepository;
    if ((await tx.artifactSource.count({ where: { projectId, source: 'local' } })) > 0) return true;
    return (await tx.sourceMigration.count({ where: { projectId, from: 'local' } })) > 0;
  }

  /** Whether the group has something to copy: `ticket` a Ticket of the Projet; `code` its code or a change of code. */
  private async holdsSomething(tx: Pick<Tx, 'ticket' | 'codeChange'>, projectId: string, group: SourceGroup, hasCode: boolean): Promise<boolean> {
    if (group === 'ticket') return (await tx.ticket.count({ where: { projectId } })) > 0;
    return hasCode || (await tx.codeChange.count({ where: { projectId } })) > 0;
  }

  private async copyMessage(tx: Pick<Tx, 'project'>, row: SourceMigrationRow): Promise<OutgoingRunnerMessage> {
    const project = await this.projectOf(tx, row.projectId);
    return {
      type: 'migration.copy',
      migrationId: row.id,
      projectId: row.projectId,
      group: row.group,
      from: row.from,
      to: row.to,
      ...((row.from === 'github' || row.to === 'github') && project.owner !== null && project.name !== null ? { repository: { owner: project.owner, name: project.name } } : {}),
    };
  }

  private projectOf(tx: Pick<Tx, 'project'>, projectId: string): Promise<MigratingProject> {
    return tx.project.findFirstOrThrow({ where: { id: projectId }, select: { id: true, displayName: true, owner: true, name: true, hasCode: true } });
  }

  private async publish(tx: Tx, row: SourceMigrationRow): Promise<SourceMigration> {
    const migration = toSourceMigration(row);
    const seq = await this.events.write(tx, currentPilotId(), 'source-migration.upserted', migration);
    await tx.sourceMigration.update({ where: { id: row.id }, data: { lastSeq: seq } });
    return migration;
  }

  /** The Pilote's Runner socket, accepted and online, if any. */
  private onlineLink(pilotId: string): RunnerLink | undefined {
    const link = this.connections.of(pilotId);
    return link?.accepted && this.presence.isOnline(pilotId) ? link : undefined;
  }

  private canMigrate(link: RunnerLink, group: SourceGroup): boolean {
    return (this.capable.get(link) ?? []).includes(group);
  }

  /** Whether the Pilote's Runner is online without `group` in its `hello.migrations`. */
  private runnerLacks(pilotId: string, group: SourceGroup): boolean {
    const link = this.onlineLink(pilotId);
    return link !== undefined && !this.canMigrate(link, group);
  }

  /** Sends to the Runner; one offline gets it again at its next `hello`. */
  private send(pilotId: string, message: OutgoingRunnerMessage): void {
    try {
      this.commands.send(pilotId, message);
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'runner.offline')) throw error;
    }
  }

  /** The drain check of `id`, once `tx` committed. */
  private later(tx: Tx, pilotId: string, id: string): void {
    afterCommit(tx, () => this.track(runInPilotScope(pilotId, () => this.drain(pilotId, id))));
  }

  private track(work: Promise<void>): void {
    const tracked = work
      .catch((error: unknown) => this.logger.error({ err: error }, 'source migration failed'))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }
}
