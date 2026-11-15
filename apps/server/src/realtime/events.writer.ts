import { type Event, type EventPayload, type EventSource, type EventType, eventPayloadSchema } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { pendingEventsOf, type Tx } from './transactions.js';

export { TransactionMissingError } from './transactions.js';

/** A payload that does not match the schema registered for its event type, or a type with none: a bug of the module writing it. */
export class EventPayloadError extends Error {
  constructor(type: EventType, reason: string) {
    super(`The payload of ${type} is refused: ${reason}`);
    this.name = 'EventPayloadError';
  }
}

/**
 * Where the change comes from, and when its source saw it (a webhook's
 * delivery, a Runner's report): the page measures the latency from `sourceAt`
 * (CORE-8), which therefore always comes with its `source`.
 */
export type WriteOptions =
  | { readonly source?: EventSource; readonly sourceAt?: undefined }
  | { readonly source: EventSource; readonly sourceAt: Date };

/** An `events` row as the socket carries it. */
export const toEvent = (row: { seq: bigint; type: string; payload: unknown; at: Date; sourceAt: Date | null; source: string | null }): Event => ({
  seq: Number(row.seq),
  type: row.type as EventType,
  payload: row.payload,
  at: row.at.toISOString(),
  ...(row.sourceAt ? { sourceAt: row.sourceAt.toISOString() } : {}),
  ...(row.source ? { source: row.source as EventSource } : {}),
});

/** The columns `toEvent` reads. */
export const EVENT_VIEW = { seq: true, type: true, payload: true, at: true, sourceAt: true, source: true } as const;

/**
 * Writes the event of a change (ADR 0007), with the `tx` of
 * `Transactions.run` that writes the change: the Pilote's `seq` incremented
 * (its row locked until the commit, so that two transactions never get the
 * same `seq`), the `events` row inserted, the event buffered until the commit.
 */
@Injectable()
export class EventsWriter {
  /** Returns the event's `seq`, which the changed row keeps in its `lastSeq`. */
  async write<T extends EventType>(tx: Tx, pilotId: string, type: T, payload: EventPayload<T>, { sourceAt, source }: WriteOptions = {}): Promise<bigint> {
    const pending = pendingEventsOf(tx);
    const schema = eventPayloadSchema(type);
    if (!schema) throw new EventPayloadError(type, 'no schema is registered for it');
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new EventPayloadError(type, parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join(', '));

    const { seq } = await tx.pilot.update({ where: { id: pilotId }, data: { seq: { increment: 1 } }, select: { seq: true } });
    // At once, the row locked: the places are taken in the order of the seqs.
    const place = pending.placeOf(pilotId);
    const row = await tx.event.create({
      data: { pilotId, seq, type, payload: parsed.data as Prisma.InputJsonValue, sourceAt: sourceAt ?? null, source: source ?? null },
      select: EVENT_VIEW,
    });
    place.events.push(toEvent(row));
    return seq;
  }

  /**
   * Takes now the lock of the Pilote's row that `write` takes, until the
   * commit: for a writer that locks another row before writing its event,
   * so that every transaction locks the Pilote first and two of them never
   * wait for each other (« Runner hors ligne », ATOI-3).
   */
  async lock(tx: Tx, pilotId: string): Promise<void> {
    await tx.pilot.update({ where: { id: pilotId }, data: { seq: { increment: 0 } }, select: { id: true } });
  }
}
