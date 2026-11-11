import { type Event, type EventPayload, type EventType, eventPayloadSchema } from '@crewdeck/contracts';
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

export interface WriteOptions {
  /** When the source saw the change (a webhook's delivery, a Runner's report): CORE-8 measures the latency from it. */
  readonly sourceAt?: Date;
}

/** An `events` row as the socket carries it. */
export const toEvent = (row: { seq: bigint; type: string; payload: unknown; at: Date; sourceAt: Date | null }): Event => ({
  seq: Number(row.seq),
  type: row.type as EventType,
  payload: row.payload,
  at: row.at.toISOString(),
  ...(row.sourceAt ? { sourceAt: row.sourceAt.toISOString() } : {}),
});

/**
 * Writes the event of a change (ADR 0007), with the `tx` of
 * `Transactions.run` that writes the change: the Pilote's `seq` incremented
 * (its row locked until the commit, so that two transactions never get the
 * same `seq`), the `events` row inserted, the event buffered until the commit.
 */
@Injectable()
export class EventsWriter {
  /** Returns the event's `seq`, which the changed row keeps in its `lastSeq`. */
  async write<T extends EventType>(tx: Tx, pilotId: string, type: T, payload: EventPayload<T>, { sourceAt }: WriteOptions = {}): Promise<bigint> {
    const pending = pendingEventsOf(tx);
    const schema = eventPayloadSchema(type);
    if (!schema) throw new EventPayloadError(type, 'no schema is registered for it');
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new EventPayloadError(type, parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join(', '));

    const { seq } = await tx.pilot.update({ where: { id: pilotId }, data: { seq: { increment: 1 } }, select: { seq: true } });
    // At once, the row locked: the places are taken in the order of the seqs.
    const place = pending.placeOf(pilotId);
    const row = await tx.event.create({
      data: { pilotId, seq, type, payload: parsed.data as Prisma.InputJsonValue, sourceAt: sourceAt ?? null },
      select: { seq: true, type: true, payload: true, at: true, sourceAt: true },
    });
    place.events.push(toEvent(row));
    return seq;
  }
}
