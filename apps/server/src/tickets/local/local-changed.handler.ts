import type { LocalChanged, LocalChangeItem, LocalMilestoneItem, LocalTicketItem, LocalUnreadable } from '@crewdeck/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DecisionsService } from '../../decisions/decisions.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProjectSources } from '../../projects/project-sources.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { Transactions, type Tx } from '../../realtime/transactions.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';
import { runInPilotScope } from '../../scope/scope.context.js';
import { MILESTONE_VIEW, toMilestone } from '../ticket.view.js';
import { TicketsWriter, type WriteOrigin } from '../tickets.writer.js';
import { changeInputOf, milestoneCounts, milestoneInputOf, ticketInputOf, UNREADABLE_FIXED, unreadableDecision } from './local-items.js';

const runnerAt = (at: string): WriteOrigin => ({ source: 'runner', sourceAt: new Date(at) });

/** Flat params as one string whatever their keys' order (jsonb sorts them its own way). */
const paramsKey = (params: unknown): string =>
  JSON.stringify(Object.entries((params ?? {}) as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * What the Runner says of a Local Projet's folder (`local.changed`, SOURCE-3,
 * ADR 0012): its Tickets, milestones and changes of code written with
 * `source: 'local'` and their events in one transaction, each event's
 * `sourceAt` the item's `observedAt` (the latency measure of a webhook's); a
 * full report removes the Local rows it does not hold; « Fichier de Ticket
 * illisible » for each file the Runner could not read. A group of the Projet
 * on GitHub drops its items. One report after the other per Pilote; never a
 * text in clear here, nor in the logs.
 */
@Injectable()
export class LocalChangedHandler implements OnModuleInit {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly writer: TicketsWriter,
    private readonly sources: ProjectSources,
    private readonly decisions: DecisionsService,
    private readonly dispatcher: RunnerDispatcher,
    @InjectPinoLogger(LocalChangedHandler.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('local.changed', (message, context) => this.reported(context.pilotId, message));
  }

  private reported(pilotId: string, message: LocalChanged): Promise<void> {
    const previous = this.queues.get(pilotId) ?? Promise.resolve();
    const run = previous.then(() => runInPilotScope(pilotId, () => this.write(pilotId, message)));
    const settled = run.catch((error: unknown) => this.logger.error({ err: error, projectId: message.projectId }, 'local changed write failed'));
    this.queues.set(pilotId, settled);
    void settled.then(() => {
      if (this.queues.get(pilotId) === settled) this.queues.delete(pilotId);
    });
    return settled;
  }

  private async write(pilotId: string, message: LocalChanged): Promise<void> {
    const { projectId } = message;
    const project = await this.prisma.scoped.project.findFirst({ where: { id: projectId }, select: { id: true } });
    if (!project) {
      this.logger.warn({ projectId }, 'local changed of an unknown project');
      return;
    }
    const ticketsLocal = !(await this.sources.isGithub(projectId, 'ticket'));
    const codeLocal = !(await this.sources.isGithub(projectId, 'code'));
    const items = sorted(message);
    const dropped = (ticketsLocal ? 0 : items.tickets.length + items.ticketsRemoved.length + items.milestones.length + items.milestonesRemoved.length + message.unreadable.length) + (codeLocal ? 0 : items.changes.length);
    if (dropped > 0) this.logger.info({ projectId, dropped, ticketsLocal, codeLocal }, 'local.not-local');

    await this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      const at = runnerAt(message.at);
      if (ticketsLocal) await this.writeTickets(tx, projectId, message.full, items, at);
      if (codeLocal) {
        for (const change of items.changes) await this.writer.upsertCodeChanges(tx, projectId, 'local', [changeInputOf(change)], runnerAt(change.observedAt));
      }
      if (ticketsLocal) await this.writeUnreadable(tx, projectId, message.unreadable);
    });
  }

  private async writeTickets(tx: Tx, projectId: string, full: boolean, items: Sorted, at: WriteOrigin): Promise<void> {
    for (const removed of items.ticketsRemoved) await this.writer.removeTicket(tx, projectId, removed.number, runnerAt(removed.observedAt));
    const observed = new Map(items.tickets.map((ticket) => [ticket.number, runnerAt(ticket.observedAt)]));
    await this.writer.upsertTickets(tx, projectId, 'local', items.tickets.map(ticketInputOf), (number) => observed.get(number) ?? at);
    if (full) {
      const held = new Set(items.tickets.map((ticket) => ticket.number));
      const gone = await tx.ticket.findMany({ where: { projectId, source: 'local', number: { notIn: [...held] } }, select: { number: true } });
      for (const { number } of gone) await this.writer.removeTicket(tx, projectId, number, at);
    }

    // The milestones, their counts from the Tickets as they now are.
    for (const removed of items.milestonesRemoved) await this.writer.removeMilestone(tx, projectId, removed.rank, at);
    const stored = (await tx.milestone.findMany({ where: { projectId, source: 'local' }, select: MILESTONE_VIEW })).map(toMilestone);
    const held = new Set(items.milestones.map((milestone) => milestone.rank));
    if (full) {
      for (const { number } of stored) if (!held.has(number)) await this.writer.removeMilestone(tx, projectId, number, at);
    }
    const kept = full ? [] : stored.filter((milestone) => !held.has(milestone.number)).map((milestone) => ({ rank: milestone.number, titleSealed: milestone.titleSealed, dueOn: milestone.dueOn }));
    const tickets = await tx.ticket.findMany({ where: { projectId }, select: { milestoneNumber: true, state: true } });
    const counts = milestoneCounts(tickets);
    for (const milestone of items.milestones) await this.writer.upsertMilestones(tx, projectId, 'local', [milestoneInputOf(milestone, counts)], runnerAt(milestone.observedAt));
    for (const milestone of kept) {
      if (milestone.titleSealed === null) continue;
      await this.writer.upsertMilestones(tx, projectId, 'local', [milestoneInputOf({ ...milestone, titleSealed: milestone.titleSealed }, counts)], at);
    }
  }

  /** The Projet's unreadable files are the message's whole set: a new one or a changed one raised, one gone resolved. */
  private async writeUnreadable(tx: Tx, projectId: string, unreadable: readonly LocalUnreadable[]): Promise<void> {
    const open = await tx.decision.findMany({
      where: { kind: 'ticket.local-unreadable', state: 'open', subjectId: { startsWith: `${projectId}:` } },
      select: { subjectId: true, params: true },
    });
    const current = new Map(open.map((decision) => [decision.subjectId, paramsKey(decision.params)]));
    const raised = new Set<string>();
    for (const file of unreadable) {
      const decision = unreadableDecision(projectId, file);
      raised.add(decision.subjectId);
      if (current.get(decision.subjectId) === paramsKey(decision.params)) continue;
      await this.decisions.raise(tx, decision);
    }
    for (const subjectId of current.keys()) {
      if (!raised.has(subjectId)) await this.decisions.resolve(tx, 'ticket.local-unreadable', subjectId, UNREADABLE_FIXED);
    }
  }
}

interface Sorted {
  readonly tickets: LocalTicketItem[];
  readonly ticketsRemoved: { number: number; observedAt: string }[];
  readonly milestones: LocalMilestoneItem[];
  readonly milestonesRemoved: { rank: number }[];
  readonly changes: LocalChangeItem[];
}

const sorted = (message: LocalChanged): Sorted => {
  const out: Sorted = { tickets: [], ticketsRemoved: [], milestones: [], milestonesRemoved: [], changes: [] };
  for (const item of message.items) {
    switch (item.kind) {
      case 'ticket':
        out.tickets.push(item);
        break;
      case 'ticket-removed':
        out.ticketsRemoved.push(item);
        break;
      case 'milestone':
        out.milestones.push(item);
        break;
      case 'milestone-removed':
        out.milestonesRemoved.push(item);
        break;
      case 'change':
        out.changes.push(item);
        break;
    }
  }
  return out;
};
