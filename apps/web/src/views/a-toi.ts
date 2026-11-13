import type { Decision, DecisionKind } from '@crewdeck/contracts';
import { formatRelative, t, type ComposantData, type IconName, type PageAToi } from '@crewdeck/sdk';
import { decisionViews, kindLabel, type DecisionViews } from './decisions/registry.js';

export type PageAToiData = ComposantData<typeof PageAToi>;

/** The icon of each kind (`design/screens/crewdeck/a-toi.html` for the nine it shows). */
const ICONS: Readonly<Record<DecisionKind, IconName>> = {
  'ticket-blocked': 'block',
  'ticket-interrupted': 'bolt',
  'permission-requested': 'shield',
  'agent-question': 'info',
  'limit-reached': 'gauge',
  'ai-account-disconnected': 'key',
  'visual-review': 'eye',
  'document-review': 'doc',
  'inventory-review': 'folder',
  'ticket-draft': 'ticket',
  'contract-incomplete': 'contract',
  'step-failed': 'alert',
  'runner-offline': 'server',
  'ideas-to-triage': 'bulb',
};

export interface AToiOptions {
  /** The Runner is « en ligne »: an action that needs it can be pressed. */
  readonly runnerOnline: boolean;
  /** The instant the relative times count from: now by default. */
  readonly now?: Date;
  /** The kinds' views: the page's registry by default. */
  readonly views?: DecisionViews;
}

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
  { runnerOnline, now = new Date(), views = decisionViews }: AToiOptions,
): PageAToiData => {
  const all = [...open].sort(newestFirst);
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
        title: view.title?.(decision) ?? decision.label,
        meta: [decision.projectName, ...decision.metaParts, formatRelative(decision.createdAt, now)].filter(Boolean).join(' · '),
        context: view.context?.(decision) ?? null,
        tone: decision.tone,
        icon: ICONS[decision.kind],
        actions: view.actions.map((action) => ({
          id: action.id,
          label: t(action.label),
          primary: action.primary ?? false,
          disabledReason: action.needsRunner && !runnerOnline ? t('aToi.runnerOffline') : null,
        })),
      };
    }),
    canNoteIdea: false,
  };
};
