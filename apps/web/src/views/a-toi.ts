import type { Decision, DecisionKind } from '@crewdeck/contracts';
import { formatRelative, t, type ComposantData, type IconName, type PageAToi } from '@crewdeck/sdk';
import type { SessionEventRead } from '../sessions/peek.js';
import { roleName as sessionRoleName } from './session.js';
import { actionsOf, decisionViews, kindLabel, type DecisionReads, type DecisionViews } from './decisions/registry.js';

export type PageAToiData = ComposantData<typeof PageAToi>;

/** The icon of each kind (`design/screens/crewdeck/a-toi.html` for the nine it shows). */
const ICONS: Readonly<Record<DecisionKind, IconName>> = {
  'ticket-blocked': 'block',
  'ticket-interrupted': 'bolt',
  'permission-requested': 'shield',
  'agent-question': 'info',
  'limit-reached': 'gauge',
  'loop-back.exhausted': 'undo',
  'ai-account-disconnected': 'key',
  'visual-review': 'eye',
  'document-review': 'doc',
  'inventory-review': 'folder',
  'ticket-draft': 'ticket',
  'contract-incomplete': 'contract',
  'step-failed': 'alert',
  'runner-offline': 'server',
  'ideas-to-triage': 'bulb',
  'project.folder-missing': 'folder',
  'source-migration.failed': 'refresh',
  'source-migration.unfinished': 'folder',
  'ticket.local-unreadable': 'doc',
};

export interface AToiOptions {
  /** The Runner is « en ligne »: an action that needs it can be pressed. */
  readonly runnerOnline: boolean;
  /** The instant the relative times count from: now by default. */
  readonly now?: Date;
  /** The kinds' views: the page's registry by default. */
  readonly views?: DecisionViews;
  /**
   * The name of a Projet a Décision has no `projectName` for (a Local
   * Projet's, sealed: `projects.ts`, `projectName`); `null` when the page
   * does not know it, the Décision then named by its `projectId`.
   */
  readonly projectName?: (projectId: string) => string | null;
  /** A Session's event read from the Runner (`sessions/peek.ts`); none read by default. */
  readonly sessionEvent?: DecisionReads['sessionEvent'];
  /** A Rôle's name; a default Rôle's, else its id, by default. */
  readonly roleName?: DecisionReads['roleName'];
  /** A Local Projet's sealed text opened; « … » by default. */
  readonly localText?: DecisionReads['localText'];
  /** A Ticket's title from the store; none by default. */
  readonly ticketTitle?: DecisionReads['ticketTitle'];
}

const NOT_READ: SessionEventRead = { state: 'reading' };
const defaultRoleName = (role: string): string => sessionRoleName(role, undefined);
const notOpened = (): string => t('local.text.pending');

/** Newest first; the same instant by id, as `GET /api/decisions` orders them. */
const newestFirst = (a: Decision, b: Decision): number =>
  b.createdAt.localeCompare(a.createdAt) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);

/**
 * « À toi »'s data (pure): the open Décisions newest first, those of the
 * Projet of `?projet=` only (every one for a Projet with none), each shown by
 * its kind's view; the chips « Tous les Projets » then one per Projet of the
 * open Décisions, by name, with its count. PROJET-2's `projects` slice will
 * give the Projets without one.
 */
export const aToiView = (
  open: Iterable<Decision>,
  query: Readonly<Record<string, string>>,
  { runnerOnline, now = new Date(), views = decisionViews, sessionEvent = () => NOT_READ, roleName = defaultRoleName, projectName: nameOf = () => null, localText = notOpened, ticketTitle = () => null }: AToiOptions,
): PageAToiData => {
  const reads: DecisionReads = { runnerOnline, sessionEvent, roleName, localText, ticketTitle };
  const all = [...open]
    .map((decision) =>
      decision.projectName === null && decision.projectId !== null ? { ...decision, projectName: nameOf(decision.projectId) ?? decision.projectId } : decision,
    )
    .sort(newestFirst);
  const counts = new Map<string, { name: string; count: number }>();
  for (const { projectId, projectName } of all) {
    if (projectId === null) continue;
    const entry = counts.get(projectId) ?? { name: projectName ?? projectId, count: 0 };
    counts.set(projectId, { ...entry, count: entry.count + 1 });
  }
  const wanted = query['projet'];
  const selected = wanted !== undefined && counts.has(wanted) ? wanted : null;
  const listed = selected === null ? all : all.filter((decision) => decision.projectId === selected);
  return {
    total: all.length,
    projects: [
      { id: null, name: t('aToi.allProjects'), count: all.length, selected: selected === null },
      ...[...counts]
        .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'fr'))
        .map(([id, { name, count }]) => ({ id, name, count, selected: id === selected })),
    ],
    decisions: listed.map((decision) => {
      const view = views.viewOf(decision.kind);
      return {
        id: decision.id,
        kind: kindLabel(decision.kind),
        title: view.title?.(decision, reads) ?? decision.label,
        meta:
          view.meta?.(decision, now) ??
          [decision.projectName, ...decision.metaParts, formatRelative(decision.createdAt, now)].filter(Boolean).join(' · '),
        context: view.context?.(decision, reads) ?? null,
        tone: decision.tone,
        icon: ICONS[decision.kind],
        actions: actionsOf(view, decision).map((action) => {
          const label = t(action.label);
          return {
            id: action.id,
            label,
            primary: action.primary ?? false,
            disabledReason: action.needsRunner && !runnerOnline ? t('runnerOffline.actionWaits', { action: label }) : null,
          };
        }),
      };
    }),
    canNoteIdea: true,
  };
};
