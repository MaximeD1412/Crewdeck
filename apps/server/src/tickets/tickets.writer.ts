import type {
  BranchPrefix,
  CheckState,
  CodeChange,
  CodeChangeState,
  MergedBy,
  Milestone,
  SealedItem,
  Ticket,
  TicketSource,
  TicketState,
  TicketStateReason,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { EventsWriter, type WriteOptions } from '../realtime/events.writer.js';
import type { Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { ticketNumberOfBranch } from './change-link.js';
import { aggregateChecks } from './checks.js';
import { branchPrefixOf, priorityOf, productLabels, READY_LABEL, sizeOf, visualReviewOf } from './labels.js';
import { isReady } from './readiness.js';
import {
  CODE_CHANGE_VIEW,
  type CodeChangeRow,
  MILESTONE_VIEW,
  type MilestoneRow,
  TICKET_VIEW,
  type TicketRow,
  toCodeChange,
  toMilestone,
  toTicket,
} from './ticket.view.js';

/** Where a write comes from and when its source saw it (a webhook's reception, a Runner's report); nothing for the reconciliation. */
export type WriteOrigin = WriteOptions;

/**
 * A Ticket as its Source has it. GitHub's: `title` and every label readable.
 * Local's (SOURCE-3): `titleSealed`, the product's labels readable and the
 * others in `labelsSealed`, and the figures the Runner computed
 * (`branchPrefix`, `visualReview`). `blockedBy` and `parentNumber` left
 * undefined keep what is stored.
 */
export interface TicketInput {
  readonly number: number;
  readonly title: string | null;
  readonly titleSealed: SealedItem | null;
  readonly state: TicketState;
  readonly stateReason: TicketStateReason | null;
  readonly closedAt: string | null;
  /** GitHub: ignored, the label `ready-for-agent` says it. Local: the front matter's `ready`. */
  readonly readyMark?: boolean;
  readonly labels: readonly string[];
  readonly labelsSealed?: SealedItem | null;
  readonly milestoneNumber: number | null;
  readonly blockedBy?: readonly number[];
  readonly parentNumber?: number | null;
  readonly branchPrefix?: BranchPrefix;
  readonly visualReview?: boolean;
  readonly sourceCreatedAt: string;
  readonly sourceUpdatedAt: string;
}

/** Only the native links of a Ticket, when an event says nothing else of it (`issue_dependencies`, `sub_issues`). */
export interface TicketLinks {
  readonly number: number;
  readonly blockedBy?: readonly number[];
  readonly parentNumber?: number | null;
}

export interface MilestoneInput {
  readonly number: number;
  readonly rank: number;
  readonly title: string | null;
  readonly titleSealed: SealedItem | null;
  readonly state: TicketState;
  readonly dueOn: string | null;
  readonly openCount: number;
  readonly closedCount: number;
  readonly closedAt: string | null;
}

/**
 * A change of code as its Source has it; `mergedBy` undefined keeps what is
 * stored (GitHub's list of PRs does not say it). `ticketNumber` undefined is
 * read from `headRef` (GitHub's); a Local change's comes from the Runner, its
 * branch's name never sent.
 */
export interface CodeChangeInput {
  readonly number: number;
  readonly ticketNumber?: number | null;
  readonly title: string | null;
  readonly titleSealed: SealedItem | null;
  readonly state: CodeChangeState;
  readonly headRef: string | null;
  readonly baseRef: string;
  readonly headSha: string | null;
  readonly mergedAt: string | null;
  readonly mergedBy?: MergedBy | null;
  readonly mergeSha: string | null;
  readonly sourceCreatedAt: string;
}

/** One check of a commit; `durationMs` and `url` undefined keep what is stored. */
export interface CheckInput {
  readonly name: string;
  readonly state: CheckState;
  readonly durationMs?: number | null;
  readonly url?: string | null;
}

type TicketData = Omit<TicketRow, 'id' | 'projectId' | 'source' | 'number' | 'ready' | 'updatedAt'>;

/** What a stored row says of the Ticket, without what the writer sets itself. */
const dataOf = (row: TicketRow): TicketData => {
  const data: Partial<TicketRow> = { ...row };
  for (const key of ['id', 'projectId', 'source', 'number', 'ready', 'updatedAt'] as const) delete data[key];
  return data as TicketData;
};

const json = (value: SealedItem | null): typeof Prisma.DbNull | Prisma.InputJsonValue => (value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue));
const date = (value: string | null): Date | null => (value === null ? null : new Date(value));
const day = (value: string | null): Date | null => (value === null ? null : new Date(`${value}T00:00:00.000Z`));

/** Whether two values of a row's column are the same (dates by instant, arrays and sealed items by content). */
const same = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
};
const unchanged = (row: Record<string, unknown>, data: Record<string, unknown>): boolean => Object.entries(data).every(([key, value]) => same(row[key], value));

/**
 * The one writer of `tickets`, `milestones`, `code_changes` and
 * `code_change_checks`, for every Source (ADR 0012): GitHub's webhooks and
 * reconciliation (`tickets.webhooks.ts`, `tickets.reconcile.ts`), Local's
 * `local.changed` (SOURCE-3). Each method writes in the caller's transaction,
 * in the current Pilote's scope, each row that changed with its event
 * (ADR 0007), and nothing for a row that did not. After any change of a
 * Ticket, `ready` is recomputed for it and for every Ticket it blocks.
 */
@Injectable()
export class TicketsWriter {
  constructor(private readonly events: EventsWriter) {}

  /** `origin` may be per Ticket's number (a Runner's report, each item observed at its own time); a dependant gets its own number's. */
  async upsertTickets(tx: Tx, projectId: string, source: TicketSource, items: readonly TicketInput[], origin: WriteOrigin | ((number: number) => WriteOrigin) = {}): Promise<Ticket[]> {
    const byNumber = new Map(items.map((item) => [item.number, item]));
    return this.writeTickets(tx, projectId, source, (number, row) => {
      const item = byNumber.get(number);
      return item ? this.ticketData(source, item, row) : undefined;
    }, [...byNumber.keys()], origin);
  }

  /** Sets the native links of Tickets already stored; a number not stored is skipped. */
  async setTicketLinks(tx: Tx, projectId: string, links: readonly TicketLinks[], origin: WriteOrigin = {}): Promise<Ticket[]> {
    const byNumber = new Map(links.map((link) => [link.number, link]));
    return this.writeTickets(tx, projectId, null, (number, row) => {
      const link = byNumber.get(number);
      if (!link || !row) return undefined;
      return { ...dataOf(row), ...(link.blockedBy === undefined ? {} : { blockedBy: [...new Set(link.blockedBy)].sort((a, b) => a - b) }), ...(link.parentNumber === undefined ? {} : { parentNumber: link.parentNumber }) };
    }, [...byNumber.keys()], origin);
  }

  /** Deletes a Ticket (its issue deleted or transferred): `ticket.removed`, then the Tickets it blocked are not ready any more. */
  async removeTicket(tx: Tx, projectId: string, number: number, origin: WriteOrigin = {}): Promise<void> {
    const row = await tx.ticket.findFirst({ where: { projectId, number }, select: { id: true } });
    if (!row) return;
    await tx.ticket.delete({ where: { id: row.id } });
    await this.events.write(tx, currentPilotId(), 'ticket.removed', { id: row.id }, origin);
    await this.writeTickets(tx, projectId, null, () => undefined, [number], origin);
  }

  async upsertMilestones(tx: Tx, projectId: string, source: TicketSource, items: readonly MilestoneInput[], origin: WriteOrigin = {}): Promise<Milestone[]> {
    const written: Milestone[] = [];
    for (const item of items) {
      const data = {
        rank: item.rank,
        title: item.title,
        titleSealed: item.titleSealed,
        state: item.state,
        dueOn: day(item.dueOn),
        openCount: item.openCount,
        closedCount: item.closedCount,
        closedAt: date(item.closedAt),
      };
      const row = await tx.milestone.findFirst({ where: { projectId, number: item.number }, select: MILESTONE_VIEW });
      if (row && row.source === source && unchanged(row, data)) continue;
      const write = { ...data, source, titleSealed: json(data.titleSealed) };
      const saved: MilestoneRow = row
        ? await tx.milestone.update({ where: { id: row.id }, data: write, select: MILESTONE_VIEW })
        : await tx.milestone.create({ data: { id: newId(), pilotId: currentPilotId(), projectId, number: item.number, ...write }, select: MILESTONE_VIEW });
      const milestone = toMilestone(saved);
      await this.events.write(tx, currentPilotId(), 'milestone.upserted', milestone, origin);
      written.push(milestone);
    }
    return written;
  }

  async removeMilestone(tx: Tx, projectId: string, number: number, origin: WriteOrigin = {}): Promise<void> {
    const row = await tx.milestone.findFirst({ where: { projectId, number }, select: { id: true } });
    if (!row) return;
    await tx.milestone.delete({ where: { id: row.id } });
    await this.events.write(tx, currentPilotId(), 'milestone.removed', { id: row.id }, origin);
  }

  /** Deletes a change of code, its checks with it: `code-change.removed`. */
  async removeCodeChange(tx: Tx, projectId: string, number: number, origin: WriteOrigin = {}): Promise<void> {
    const row = await tx.codeChange.findFirst({ where: { projectId, number }, select: { id: true } });
    if (!row) return;
    await tx.codeChange.delete({ where: { id: row.id } });
    await this.events.write(tx, currentPilotId(), 'code-change.removed', { id: row.id }, origin);
  }

  /**
   * Writes changes of code: the Ticket each delivers from its head branch,
   * and, when its head moves, the `checks` of the new head from the rows
   * already stored for that commit.
   */
  async upsertCodeChanges(tx: Tx, projectId: string, source: TicketSource, items: readonly CodeChangeInput[], origin: WriteOrigin = {}): Promise<CodeChange[]> {
    const written: CodeChange[] = [];
    for (const item of items) {
      const row = await tx.codeChange.findFirst({ where: { projectId, number: item.number }, select: CODE_CHANGE_VIEW });
      const data = {
        ticketNumber: item.ticketNumber !== undefined ? item.ticketNumber : item.headRef === null ? null : ticketNumberOfBranch(item.headRef),
        title: item.title,
        titleSealed: item.titleSealed,
        state: item.state,
        headRef: item.headRef,
        baseRef: item.baseRef,
        headSha: item.headSha,
        mergedAt: date(item.mergedAt),
        mergedBy: item.mergedBy === undefined ? (row?.mergedBy ?? null) : item.mergedBy,
        mergeSha: item.mergeSha,
        sourceCreatedAt: new Date(item.sourceCreatedAt),
        ...(row && row.checksSha === item.headSha ? {} : await this.checksOf(tx, row?.id, item.headSha)),
      };
      if (row && row.source === source && unchanged(row, data)) continue;
      const write = { ...data, source, titleSealed: json(data.titleSealed) };
      const saved: CodeChangeRow = row
        ? await tx.codeChange.update({ where: { id: row.id }, data: write, select: CODE_CHANGE_VIEW })
        : await tx.codeChange.create({ data: { id: newId(), pilotId: currentPilotId(), projectId, number: item.number, ...write }, select: CODE_CHANGE_VIEW });
      const change = toCodeChange(saved);
      await this.events.write(tx, currentPilotId(), 'code-change.upserted', change, origin);
      written.push(change);
    }
    return written;
  }

  /**
   * Stores the checks of commit `sha` for the changes of code whose head it
   * is, and recomputes their `checks`. A commit no change has as its head
   * (an older one) is ignored: its checks never move the current state.
   */
  async setChecks(tx: Tx, projectId: string, sha: string, checks: readonly CheckInput[], origin: WriteOrigin = {}): Promise<CodeChange[]> {
    const changes = await tx.codeChange.findMany({ where: { projectId, headSha: sha }, select: CODE_CHANGE_VIEW });
    const written: CodeChange[] = [];
    for (const change of changes) {
      for (const check of checks) {
        const extra = { ...(check.durationMs === undefined ? {} : { durationMs: check.durationMs }), ...(check.url === undefined ? {} : { url: check.url }) };
        const row = await tx.codeChangeCheck.findFirst({ where: { codeChangeId: change.id, sha, name: check.name }, select: { id: true, state: true, durationMs: true, url: true } });
        if (row && unchanged(row, { state: check.state, ...extra })) continue;
        if (row) await tx.codeChangeCheck.update({ where: { id: row.id }, data: { state: check.state, ...extra } });
        else await tx.codeChangeCheck.create({ data: { id: newId(), pilotId: currentPilotId(), codeChangeId: change.id, sha, name: check.name, state: check.state, ...extra } });
      }
      const next = await this.checksOf(tx, change.id, sha);
      if (unchanged(change, next)) continue;
      const saved = await tx.codeChange.update({ where: { id: change.id }, data: next, select: CODE_CHANGE_VIEW });
      const view = toCodeChange(saved);
      await this.events.write(tx, currentPilotId(), 'code-change.upserted', view, origin);
      written.push(view);
    }
    return written;
  }

  /** The `checks` of a change of code at `sha`, from the rows stored for that commit. */
  private async checksOf(tx: Tx, codeChangeId: string | undefined, sha: string | null): Promise<Pick<CodeChangeRow, 'checks' | 'checksSha'>> {
    if (codeChangeId === undefined || sha === null) return { checks: 'none', checksSha: sha };
    const rows = await tx.codeChangeCheck.findMany({ where: { codeChangeId, sha }, select: { state: true } });
    return { checks: aggregateChecks(rows.map((row) => row.state)), checksSha: sha };
  }

  private ticketData(source: TicketSource, item: TicketInput, row: TicketRow | undefined): TicketData {
    const github = source === 'github';
    const labels = github ? [...item.labels] : productLabels(item.labels);
    return {
      title: item.title,
      titleSealed: item.titleSealed,
      state: item.state,
      stateReason: item.state === 'closed' ? item.stateReason : null,
      closedAt: item.state === 'closed' ? date(item.closedAt) : null,
      readyMark: github ? labels.includes(READY_LABEL) : (item.readyMark ?? false),
      labels,
      labelsSealed: github ? null : (item.labelsSealed ?? null),
      priority: priorityOf(labels),
      size: sizeOf(labels),
      milestoneNumber: item.milestoneNumber,
      blockedBy: item.blockedBy === undefined ? (row?.blockedBy ?? []) : [...new Set(item.blockedBy)].sort((a, b) => a - b),
      parentNumber: item.parentNumber === undefined ? (row?.parentNumber ?? null) : item.parentNumber,
      branchPrefix: github ? branchPrefixOf(labels) : (item.branchPrefix ?? 'feat'),
      visualReview: github ? visualReviewOf(labels) : (item.visualReview ?? false),
      sourceCreatedAt: new Date(item.sourceCreatedAt),
      sourceUpdatedAt: new Date(item.sourceUpdatedAt),
    } as TicketData;
  }

  /**
   * Writes the Tickets `numbers` with the data `next` gives each (undefined:
   * unchanged), then recomputes `ready` for them and for the Tickets they
   * block, against the Projet's Tickets as they now are. Each row whose data
   * or `ready` moved gets its `ticket.upserted`: the written ones first.
   */
  private async writeTickets(
    tx: Tx,
    projectId: string,
    source: TicketSource | null,
    next: (number: number, row: TicketRow | undefined) => TicketData | undefined,
    numbers: readonly number[],
    origin: WriteOrigin | ((number: number) => WriteOrigin),
  ): Promise<Ticket[]> {
    const originOf = typeof origin === 'function' ? origin : () => origin;
    const rows = await tx.ticket.findMany({ where: { projectId }, select: TICKET_VIEW });
    const byNumber = new Map<number, TicketRow>(rows.map((row) => [row.number, row]));
    const changes = new Map<number, TicketData>();
    for (const number of new Set(numbers)) {
      const row = byNumber.get(number);
      const data = next(number, row);
      if (!data) continue;
      if (row && row.source === (source ?? row.source) && unchanged(row, data)) continue;
      changes.set(number, data);
    }
    const states = new Map<number, { state: TicketState }>(rows.map((row) => [row.number, row]));
    for (const [number, data] of changes) states.set(number, data);
    const moved = new Set([...changes.keys(), ...numbers.filter((number) => !byNumber.has(number) && !changes.has(number))]);
    const dependants = rows.filter((row) => !changes.has(row.number) && row.blockedBy.some((number) => moved.has(number)));

    const written: Ticket[] = [];
    for (const [number, data] of changes) {
      const row = byNumber.get(number);
      const ready = isReady(data, states);
      const write = { ...data, ready, titleSealed: json(data.titleSealed as SealedItem | null), labelsSealed: json(data.labelsSealed as SealedItem | null), ...(source ? { source } : {}) };
      const saved = row
        ? await tx.ticket.update({ where: { id: row.id }, data: write, select: TICKET_VIEW })
        : await tx.ticket.create({ data: { id: newId(), pilotId: currentPilotId(), projectId, number, source: source ?? 'github', ...write }, select: TICKET_VIEW });
      written.push(await this.emit(tx, saved, originOf(number)));
    }
    for (const row of dependants) {
      const ready = isReady(row, states);
      if (ready === row.ready) continue;
      const saved = await tx.ticket.update({ where: { id: row.id }, data: { ready }, select: TICKET_VIEW });
      written.push(await this.emit(tx, saved, originOf(row.number)));
    }
    return written;
  }

  private async emit(tx: Tx, row: TicketRow, origin: WriteOrigin): Promise<Ticket> {
    const ticket = toTicket(row);
    await this.events.write(tx, currentPilotId(), 'ticket.upserted', ticket, origin);
    return ticket;
  }
}
