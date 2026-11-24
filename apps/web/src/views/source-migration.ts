import {
  groupsOfPhase,
  RUNNING_SOURCE_MIGRATION_STATES,
  type CodeChange,
  type PhaseRun,
  type ProcessDefinition,
  type Project,
  type SourceGroup,
  type SourceKind,
  type SourceMigration,
  type SourceMigrationWaitingItem,
} from '@crewdeck/contracts';
import { formatDate, formatNumber, t, type IconName, type MessageKey } from '@crewdeck/sdk';
import type { ConfirmDialogOptions } from '../dialogs/confirm.js';
import { typeLabel } from '../process/canvas.js';

/** What the Sources read of the store for one Projet, beyond its Process (SOURCE-7). */
export interface SourceMigrationReads {
  readonly project: Pick<Project, 'id' | 'displayName' | 'fullName' | 'hasCode'>;
  /** The definition the Projet's work runs: its active version's, else its draft's. */
  readonly definition: ProcessDefinition | null;
  readonly migrations: Iterable<SourceMigration>;
  readonly phaseRuns: Iterable<Pick<PhaseRun, 'projectId' | 'phaseId' | 'state' | 'waitingOn'>>;
  readonly tickets: Iterable<{ readonly projectId: string }>;
  readonly codeChanges: Iterable<Pick<CodeChange, 'projectId' | 'source' | 'state'>>;
  /** The Runner's machine, where a Local Source lives. */
  readonly machine: string;
}

const RUNNING: readonly string[] = RUNNING_SOURCE_MIGRATION_STATES;

/** « Local », « GitHub ». */
export const sourceLabel = (kind: SourceKind): string => t(`process.sources.${kind}`);

/** The migration of the Projet still running (at most one, ADR 0012), whatever its group. */
export const runningMigrationOf = (migrations: Iterable<SourceMigration>, projectId: string): SourceMigration | null => {
  for (const migration of migrations) if (migration.projectId === projectId && RUNNING.includes(migration.state)) return migration;
  return null;
};

/** The group's last migration done, the one its Source came from. */
export const lastDoneOf = (migrations: Iterable<SourceMigration>, projectId: string, group: SourceGroup): SourceMigration | null => {
  let last: SourceMigration | null = null;
  for (const migration of migrations) {
    if (migration.projectId !== projectId || migration.group !== group || migration.state !== 'done') continue;
    if (!last || migration.createdAt > last.createdAt) last = migration;
  }
  return last;
};

/** Where a group lives on a Source: the repository on GitHub, the Projet's folder on the Runner's machine. */
export const placeOf = (group: SourceGroup, kind: SourceKind, project: Pick<Project, 'fullName'>, machine: string): string =>
  kind === 'github' ? (project.fullName ?? '') : t(`process.sources.${group}.local`, { machine });

const count = <T>(items: Iterable<T>, keep: (item: T) => boolean): number => {
  let n = 0;
  for (const item of items) if (keep(item)) n += 1;
  return n;
};

/** Whether the group has something to copy, as the server judges it: a Ticket; the code, or a change of code. */
export const holdsSomething = (reads: SourceMigrationReads, group: SourceGroup): boolean => {
  const { project } = reads;
  if (group === 'ticket') return count(reads.tickets, (ticket) => ticket.projectId === project.id) > 0;
  return project.hasCode || count(reads.codeChanges, (change) => change.projectId === project.id) > 0;
};

/** The work of the group in progress, which a migration lets finish on the old Source: not waiting its turn. */
export const inProgressOf = (reads: SourceMigrationReads, group: SourceGroup): number => {
  const { definition, project } = reads;
  if (!definition) return 0;
  return count(
    reads.phaseRuns,
    (run) =>
      run.projectId === project.id &&
      (run.state === 'running' || run.state === 'waiting') &&
      run.waitingOn !== 'queue' &&
      run.waitingOn !== 'source-migration' &&
      definition.phases.some((phase) => phase.id === run.phaseId) &&
      groupsOfPhase(definition, run.phaseId).includes(group),
  );
};

const plural = (n: number) => (n === 1 ? 'one' : 'other');

/** « #12 et #14 », the items a draining waits for, by their number when they have one. */
const itemsText = (items: readonly SourceMigrationWaitingItem[]): string =>
  new Intl.ListFormat('fr', { type: 'conjunction' }).format(items.map((item) => (item.number === undefined ? typeLabel(item.itemType) : `#${item.number}`)));

/** The caution badge of a migration running: « Local → GitHub ». */
export const migrationBadge = (migration: Pick<SourceMigration, 'from' | 'to'>): string =>
  t('process.sources.migration.badge', { from: sourceLabel(migration.from), to: sourceLabel(migration.to) });

/** Where a running migration is, the meta of its row: « migration en cours · 2 Tickets à finir sur Local », « copie : 12 sur 30 »… */
export const migrationMeta = (migration: SourceMigration): string => {
  switch (migration.state) {
    case 'draining': {
      const items = migration.waitingItems;
      if (items.length === 0) return t('process.sources.migration.meta.draining');
      const waiting = items.every((item) => item.itemType === 'ticket')
        ? t(`process.sources.migration.waiting.items.${plural(items.length)}`, { count: formatNumber(items.length) })
        : formatNumber(items.length);
      return t('process.sources.migration.meta.draining.waiting', { waiting, from: sourceLabel(migration.from) });
    }
    case 'copying':
      return t('process.sources.migration.meta.copying', { copied: formatNumber(migration.copied), total: formatNumber(migration.total) });
    case 'verifying':
      return t('process.sources.migration.meta.verifying');
    default:
      return t('process.sources.migration.meta.switched');
  }
};

/** « les 30 Tickets passent », « le code passe »: what moves at the switch. */
const movedText = (group: SourceGroup, tickets: number): string => {
  if (group === 'code') return t('process.sources.migration.code.moved');
  if (tickets === 0) return t('process.sources.migration.ticket.moved.unknown');
  return t(`process.sources.migration.ticket.moved.${plural(tickets)}`, { count: formatNumber(tickets) });
};

/**
 * The caution Banner of a migration running: « Migration des Tickets vers
 * GitHub », « Aucun nouveau Ticket ne démarre. #12 et #14 finissent sur
 * Local, puis les 30 Tickets passent sur GitHub d’un coup. » while it
 * drains; the Tickets counted by the Runner once it copies, else those the
 * page holds.
 */
export const migrationBanner = (migration: SourceMigration, reads: Pick<SourceMigrationReads, 'project' | 'tickets'>): { title: string; text: string } => {
  const { group } = migration;
  const to = sourceLabel(migration.to);
  const noun = t(`process.sources.migration.${group}.noun`);
  const title = t(`process.sources.migration.${group}.title`, { to });
  if (migration.state === 'switched') return { title, text: t('process.sources.migration.banner.switched', { group: t(`process.sources.migration.${group}.group`), to }) };
  if (migration.state !== 'draining') return { title, text: t('process.sources.migration.banner.running', { noun }) };
  const tickets = migration.total > 0 ? migration.total : count(reads.tickets, (ticket) => ticket.projectId === reads.project.id);
  const moved = movedText(group, tickets);
  const items = migration.waitingItems;
  if (items.length === 0) return { title, text: t('process.sources.migration.banner.draining.none', { noun, moved, to }) };
  return {
    title,
    text: t('process.sources.migration.banner.draining', {
      noun,
      waiting: itemsText(items),
      finish: t(`process.sources.migration.finish.${plural(items.length)}`),
      from: sourceLabel(migration.from),
      moved,
      to,
    }),
  };
};

/** The meta of a group whose last migration is done: « … · depuis le 19 nov. (migré de Local) ». */
export const doneMeta = (detail: string, migration: SourceMigration): string =>
  t('process.sources.migration.done', { detail, date: formatDate(migration.switchedAt ?? migration.endedAt ?? migration.createdAt), from: sourceLabel(migration.from) });

const ICON: Readonly<Record<SourceKind, IconName>> = { github: 'github', local: 'folder' };

/** What the dialog of a migration names beyond the store (SOURCE-9). */
export interface MigrationContext {
  /**
   * The repository the group goes to or leaves: the one picked, `null` while
   * none is; absent, the Projet's.
   */
  readonly repository?: string | null;
  /** The folder typed for the code going Local, `null` while none is; absent, the Projet's own. */
  readonly folder?: string | null;
  /** Where the Tickets are: leaving GitHub, the repository stays followed while they are there. */
  readonly ticketSource?: SourceKind;
}

const zeroOnePlural = (n: number) => (n === 0 ? 'zero' : plural(n));

/** The open changes of code the migration turns into the other Source's: draft or open, on `from`. */
const openChangesOf = (reads: SourceMigrationReads, from: SourceKind): number =>
  count(reads.codeChanges, (change) => change.projectId === reads.project.id && change.source === from && (change.state === 'draft' || change.state === 'open'));

/** « Puis les branches du dossier sont poussées sur … », « Puis … est cloné dans … »: the code's copy (SOURCE-9). */
const codeCopyText = (reads: SourceMigrationReads, from: SourceKind, to: SourceKind, repository: string, folder: string | null | undefined): string => {
  const open = openChangesOf(reads, from);
  const into =
    folder === undefined ? t('process.sources.migration.confirm.folder.project') : folder === null || folder.trim() === '' ? t('process.sources.migration.confirm.folder.picked') : folder;
  return t(`process.sources.migration.confirm.copy.code.${to}.${zeroOnePlural(open)}`, { repository, folder: into, count: formatNumber(open) });
};

/**
 * The core's confirmation of `source.migrate` (US-102, US-26): « Passer les
 * Tickets de Site mairie sur GitHub ? », what holds during the migration,
 * what is copied (or that nothing is), what is archived, and that a Type
 * d’artefact never has two Sources.
 */
export const migrationConfirmation = (
  reads: SourceMigrationReads,
  group: SourceGroup,
  from: SourceKind,
  to: SourceKind,
  context: MigrationContext = {},
): ConfirmDialogOptions => {
  const { project, machine } = reads;
  const repository = (context.repository === undefined ? project.fullName : context.repository) ?? t('process.sources.migration.confirm.repository.picked');
  const noun = t(`process.sources.migration.${group}.noun`);
  const running = inProgressOf(reads, group);
  const fromLabel = sourceLabel(from);
  const tickets = count(reads.tickets, (ticket) => ticket.projectId === project.id);
  const copy = !holdsSomething(reads, group)
    ? t('process.sources.migration.confirm.copy.nothing')
    : group === 'ticket'
      ? t(`process.sources.migration.confirm.copy.ticket.${to}.${plural(tickets)}`, { count: formatNumber(tickets) })
      : codeCopyText(reads, from, to, repository, context.folder);
  const drain =
    running === 0
      ? t('process.sources.migration.confirm.drain.none', { noun })
      : t('process.sources.migration.confirm.drain', {
          noun,
          running: t(`process.sources.migration.confirm.running.${group}.${plural(running)}`, { count: formatNumber(running) }),
          from: fromLabel,
        });
  // Leaving GitHub, the code's repository stays followed while the Tickets are there (SOURCE-9).
  const followed = group === 'code' && from === 'github' && context.ticketSource === 'github' ? '.followed' : '';
  const archived = t(`process.sources.migration.confirm.archived.${group}.${from}${followed}` as MessageKey, { repository });
  return {
    title: t(`process.sources.migration.confirm.${group}.title`, { project: project.displayName ?? '', to: sourceLabel(to) }),
    confirmLabel: t(`process.sources.migration.confirm.${group}.label`),
    icon: ICON[to],
    tone: 'primary',
    consequences: {
      lead: t('process.sources.migration.confirm.lead', { from: fromLabel, to: sourceLabel(to), place: to === 'github' ? repository : placeOf(group, to, project, machine) }),
      items: [
        { strong: '', text: drain },
        { strong: '', text: copy },
        ...(group === 'code' ? [{ strong: '', text: t('process.sources.migration.confirm.documents') }] : []),
        { strong: '', text: archived },
      ],
      note: t('process.sources.migration.confirm.note'),
    },
  };
};
