import type { CodeChange, Milestone, Ticket } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { CODE_CHANGE_VIEW, MILESTONE_VIEW, TICKET_VIEW, toCodeChange, toMilestone, toTicket } from './ticket.view.js';

/** How long a closed Ticket, milestone or change of code stays in `GET /api/state`. */
export const RECENTLY_CLOSED_DAYS = 30;

const recently = (): Date => new Date(Date.now() - RECENTLY_CLOSED_DAYS * 24 * 60 * 60_000);

/** The `tickets` slice: every open Ticket of every Projet, and those closed in the last 30 days. */
@Injectable()
export class TicketState implements StateContributor<'tickets'>, OnModuleInit {
  readonly key = 'tickets';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<Ticket[]> {
    const rows = await tx.ticket.findMany({
      where: { OR: [{ state: 'open' }, { closedAt: { gte: recently() } }] },
      orderBy: [{ projectId: 'asc' }, { number: 'desc' }],
      select: TICKET_VIEW,
    });
    return rows.map(toTicket);
  }
}

/** The `milestones` slice: the open milestones, and those closed in the last 30 days. */
@Injectable()
export class MilestoneState implements StateContributor<'milestones'>, OnModuleInit {
  readonly key = 'milestones';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<Milestone[]> {
    const rows = await tx.milestone.findMany({
      where: { OR: [{ state: 'open' }, { closedAt: { gte: recently() } }] },
      orderBy: [{ projectId: 'asc' }, { rank: 'asc' }],
      select: MILESTONE_VIEW,
    });
    return rows.map(toMilestone);
  }
}

/** The `codeChanges` slice: the open and draft changes of code, and those merged or closed in the last 30 days. */
@Injectable()
export class CodeChangeState implements StateContributor<'codeChanges'>, OnModuleInit {
  readonly key = 'codeChanges';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<CodeChange[]> {
    const rows = await tx.codeChange.findMany({
      where: { OR: [{ state: { in: ['open', 'draft'] } }, { state: { in: ['merged', 'closed'] }, updatedAt: { gte: recently() } }] },
      orderBy: [{ projectId: 'asc' }, { number: 'desc' }],
      select: CODE_CHANGE_VIEW,
    });
    return rows.map(toCodeChange);
  }
}
