import { type Decision, type DecisionKind, zDecision } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import type { Prisma } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { EventsWriter } from '../realtime/events.writer.js';
import type { Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { DECISION_VIEW, toDecision } from './decision.view.js';

/** What a module raises: a Décision of the contracts without what the service sets. */
export type RaiseInput = Omit<Decision, 'id' | 'state' | 'outcome' | 'createdAt' | 'resolvedAt'>;

/** The input of `raise`, checked against the Décision's schema (its kind, its bounds, its flat params). */
const zRaiseInput = zDecision.omit({ id: true, state: true, outcome: true, createdAt: true, resolvedAt: true });

/** A module's call with an input the contracts refuse: its bug, a 500. */
export class DecisionInputError extends Error {
  constructor(reason: string) {
    super(`A Décision is refused: ${reason}`);
    this.name = 'DecisionInputError';
  }
}

/**
 * The Décisions (CONTEXT.md, ATOI-1): every module raises and resolves its
 * own with this service, inside its `Transactions.run`, in the scope of the
 * Pilote they wait for. The page never resolves one: there is no generic
 * « answer » route, the module's command does it.
 */
@Injectable()
export class DecisionsService {
  constructor(private readonly events: EventsWriter) {}

  /**
   * Opens the Décision of `(kind, subjectId)`, or updates the open one (its
   * label, metaParts, tone, link, params, Projet), and writes
   * `decision.upserted` with `tx`. Every value is readable by the server
   * (ADR 0003): never free text of the Pilote or an agent. A module that has
   * such text (a question, a blocking reason) leaves it out: the page reads it
   * from GitHub or the Runner. The open one resolved by another transaction
   * between its read and its update stays resolved: a new one is opened.
   */
  async raise(tx: Tx, input: RaiseInput): Promise<{ decision: Decision; created: boolean }> {
    const parsed = zRaiseInput.safeParse(input);
    if (!parsed.success) throw new DecisionInputError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`).join(', '));
    const { kind, subjectId, params, ...rest } = parsed.data;
    const values = { ...rest, params: params as Prisma.InputJsonValue };
    const open = await tx.decision.findFirst({ where: { kind, subjectId, state: 'open' }, select: { id: true } });
    const [updated] = open ? await this.whileOpen(tx, open.id, values) : [];
    const row =
      updated ?? (await tx.decision.create({ data: { id: newId(), pilotId: currentPilotId(), kind, subjectId, ...values }, select: DECISION_VIEW }));
    const decision = toDecision(row);
    await this.events.write(tx, currentPilotId(), 'decision.upserted', decision);
    return { decision, created: !updated };
  }

  /**
   * Updates the Décision `id` only if it is still open: one resolved by
   * another transaction since it was read (and committed, PostgreSQL
   * re-reading the row it waited for) is left as is, and nothing is returned.
   */
  private whileOpen(tx: Tx, id: string, data: Prisma.DecisionUpdateManyMutationInput) {
    return tx.decision.updateManyAndReturn({ where: { id, state: 'open' }, data, select: DECISION_VIEW });
  }

  /**
   * Resolves the open Décision of `(kind, subjectId)` with `outcome` and
   * writes `decision.removed`; none open (or resolved meanwhile by another
   * transaction), nothing.
   */
  async resolve(tx: Tx, kind: DecisionKind, subjectId: string, outcome: string): Promise<Decision | undefined> {
    const open = await tx.decision.findFirst({ where: { kind, subjectId, state: 'open' }, select: { id: true } });
    if (!open) return undefined;
    const [row] = await this.whileOpen(tx, open.id, { state: 'resolved', outcome, resolvedAt: new Date() });
    if (!row) return undefined;
    await this.events.write(tx, currentPilotId(), 'decision.removed', { id: row.id });
    return toDecision(row);
  }

  /** The open Décision `id`, for a command that answers it: 409 when it was already, 404 when it is not the Pilote's. */
  async assertOpen(tx: Tx, id: string): Promise<Decision> {
    const row = await tx.decision.findFirst({ where: { id }, select: DECISION_VIEW });
    if (!row) throw new AppError(404, 'decision.not-found', MESSAGES['decision.not-found']);
    if (row.state !== 'open') throw new AppError(409, 'decision.already-answered', MESSAGES['decision.already-answered']);
    return toDecision(row);
  }
}
