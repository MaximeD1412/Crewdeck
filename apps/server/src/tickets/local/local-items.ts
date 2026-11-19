import {
  type LocalChangeItem,
  type LocalMilestoneItem,
  localSealedParam,
  type LocalTicketItem,
  type LocalUnreadable,
  type LocalUnreadableReason,
  type TicketState,
} from '@crewdeck/contracts';
import type { RaiseInput } from '../../decisions/decisions.service.js';
import type { CodeChangeInput, MilestoneInput, TicketInput } from '../tickets.writer.js';

/**
 * What the server writes of a Local Projet's `local.changed` (SOURCE-3, ADR
 * 0012): the same rows as GitHub's, every text sealed by the Runner, read by
 * no one here.
 */

/** A Local Ticket: its title sealed, its milestone by rank, the figures the Runner computed from its labels. */
export const ticketInputOf = (item: LocalTicketItem): TicketInput => ({
  number: item.number,
  title: null,
  titleSealed: item.titleSealed,
  state: item.state,
  stateReason: item.stateReason,
  closedAt: item.closedAt,
  readyMark: item.readyMark,
  labels: item.labels,
  labelsSealed: item.labelsSealed,
  milestoneNumber: item.milestoneRank,
  blockedBy: item.blockedBy,
  parentNumber: item.parent,
  branchPrefix: item.branchPrefix,
  visualReview: item.visualReview,
  sourceCreatedAt: item.createdAt,
  sourceUpdatedAt: item.updatedAt,
});

/** The open and closed Tickets of each milestone, by its number (a Local one's rank). */
export type MilestoneCounts = ReadonlyMap<number, { readonly open: number; readonly closed: number }>;

export const milestoneCounts = (tickets: readonly { readonly milestoneNumber: number | null; readonly state: TicketState }[]): MilestoneCounts => {
  const counts = new Map<number, { open: number; closed: number }>();
  for (const { milestoneNumber, state } of tickets) {
    if (milestoneNumber === null) continue;
    const count = counts.get(milestoneNumber) ?? { open: 0, closed: 0 };
    count[state] += 1;
    counts.set(milestoneNumber, count);
  }
  return counts;
};

/** A Local milestone, numbered by its rank in `milestones.yml`, always open (the file has no state), its counts from its Tickets. */
export const milestoneInputOf = (item: Pick<LocalMilestoneItem, 'rank' | 'titleSealed' | 'dueOn'>, counts: MilestoneCounts): MilestoneInput => ({
  number: item.rank,
  rank: item.rank,
  title: null,
  titleSealed: item.titleSealed,
  state: 'open',
  dueOn: item.dueOn,
  openCount: counts.get(item.rank)?.open ?? 0,
  closedCount: counts.get(item.rank)?.closed ?? 0,
  closedAt: null,
});

/** A Local change of code: the Ticket it delivers as the Runner read it from its branch, whose name never comes here. */
export const changeInputOf = (item: LocalChangeItem): CodeChangeInput => ({
  number: item.number,
  ticketNumber: item.ticketNumber,
  title: null,
  titleSealed: item.titleSealed,
  state: item.state,
  headRef: null,
  baseRef: item.baseRef,
  headSha: item.headSha,
  mergedAt: item.mergedAt,
  mergeSha: item.mergeSha,
  sourceCreatedAt: item.createdAt,
});

/** The outcome of « Fichier de Ticket illisible » once the file reads, or is gone. */
export const UNREADABLE_FIXED = 'fixed';

const REASONS: Readonly<Record<LocalUnreadableReason, string>> = {
  'front-matter': 'front matter illisible',
  'duplicate-number': 'numéro déjà pris par un autre fichier',
};

/** The subject of an unreadable file's Décision: its Projet and its path's key. */
export const unreadableSubject = (projectId: string, key: string): string => `${projectId}:${key}`;

/**
 * « Fichier de Ticket illisible » of a file of `tickets/`: caution, its
 * reason readable, its path sealed in its params (the page opens it), no name.
 */
export const unreadableDecision = (projectId: string, unreadable: LocalUnreadable): RaiseInput => ({
  kind: 'ticket.local-unreadable',
  projectId,
  projectName: null,
  subjectType: 'project',
  subjectId: unreadableSubject(projectId, unreadable.key),
  label: 'Fichier de Ticket illisible',
  metaParts: [REASONS[unreadable.reason]],
  tone: 'caution',
  link: `/projets/${projectId}`,
  params: { pathSealed: localSealedParam(unreadable.pathSealed), reason: unreadable.reason },
});
