import { type LocalChangeItem, type LocalMilestoneItem, type LocalTicketItem, type LocalUnreadable, localSealedParam, zLocalChanged } from '@crewdeck/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  changeInputOf,
  milestoneCounts,
  milestoneInputOf,
  ticketInputOf,
  UNREADABLE_FIXED,
  unreadableDecision,
  unreadableSubject,
} from './local-items.js';

const fixture = zLocalChanged.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../../packages/contracts/fixtures/runner/local.changed.json'), 'utf8')));
const item = <K extends string>(kind: K) => {
  const found = fixture.items.find((candidate) => candidate.kind === kind);
  if (!found) throw new Error(`no ${kind} in the fixture`);
  return found;
};

describe('a Local Projet’s items', () => {
  it('makes a ticket item a Local Ticket: its title sealed, its milestone by rank, the Runner’s figures', () => {
    const ticket = item('ticket') as LocalTicketItem;
    expect(ticketInputOf(ticket)).toEqual({
      number: 12,
      title: null,
      titleSealed: ticket.titleSealed,
      state: ticket.state,
      stateReason: ticket.stateReason,
      closedAt: ticket.closedAt,
      readyMark: ticket.readyMark,
      labels: ['priority:P1', 'size:S', 'ready-for-agent'],
      labelsSealed: ticket.labelsSealed,
      milestoneNumber: 1,
      blockedBy: [7],
      parentNumber: null,
      branchPrefix: 'fix',
      visualReview: true,
      sourceCreatedAt: ticket.createdAt,
      sourceUpdatedAt: ticket.updatedAt,
    });
  });

  it('names a milestone by its rank, its counts from the Projet’s Tickets', () => {
    const milestone = item('milestone') as LocalMilestoneItem;
    const counts = milestoneCounts([
      { milestoneNumber: 1, state: 'open' },
      { milestoneNumber: 1, state: 'closed' },
      { milestoneNumber: 1, state: 'open' },
      { milestoneNumber: 2, state: 'closed' },
      { milestoneNumber: null, state: 'open' },
    ]);
    expect(milestoneInputOf(milestone, counts)).toEqual({
      number: 1,
      rank: 1,
      title: null,
      titleSealed: milestone.titleSealed,
      state: 'open',
      dueOn: '2026-12-15',
      openCount: 2,
      closedCount: 1,
      closedAt: null,
    });
    expect(milestoneInputOf({ ...milestone, rank: 3 }, counts)).toMatchObject({ openCount: 0, closedCount: 0 });
  });

  it('links a change to its Ticket as the Runner read it, never by a branch’s name', () => {
    const change = item('change') as LocalChangeItem;
    expect(changeInputOf(change)).toEqual({
      number: 31,
      ticketNumber: 12,
      title: null,
      titleSealed: change.titleSealed,
      state: change.state,
      headRef: null,
      baseRef: 'main',
      headSha: change.headSha,
      mergedAt: change.mergedAt,
      mergeSha: change.mergeSha,
      sourceCreatedAt: change.createdAt,
    });
  });

  it('raises « Fichier de Ticket illisible » for an unreadable file, its path sealed in its params', () => {
    const unreadable = fixture.unreadable[0] as LocalUnreadable;
    const decision = unreadableDecision(fixture.projectId, unreadable);
    expect(decision).toEqual({
      kind: 'ticket.local-unreadable',
      projectId: fixture.projectId,
      projectName: null,
      subjectType: 'project',
      subjectId: `${fixture.projectId}:AAECAwQFBgcICQoLDA0ODw`,
      label: 'Fichier de Ticket illisible',
      metaParts: ['front matter illisible'],
      tone: 'caution',
      link: `/projets/${fixture.projectId}`,
      params: { pathSealed: localSealedParam(unreadable.pathSealed), reason: 'front-matter' },
    });
    expect(unreadableSubject(fixture.projectId, unreadable.key)).toBe(decision.subjectId);
    expect(unreadableDecision(fixture.projectId, { ...unreadable, reason: 'duplicate-number' }).metaParts).toEqual(['numéro déjà pris par un autre fichier']);
    expect(UNREADABLE_FIXED).toBe('fixed');
  });
});
