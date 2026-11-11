import { Injectable } from '@nestjs/common';
import { PrismaService, type ScopedPrisma } from '../prisma/prisma.service.js';
import { EventsBus } from './events.bus.js';
import { type Place, PublicationOrder } from './publication-order.js';

/** The client of an interactive transaction of `prisma.scoped`: what a change and its events are written with. */
export type Tx = Parameters<Parameters<ScopedPrisma['$transaction']>[0]>[0];

export interface TransactionOptions {
  readonly isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

/** What a transaction of `Transactions.run` has written so far: its place, per Pilote, in the order of publication. */
export class TransactionEvents {
  private readonly places = new Map<string, Place>();

  constructor(private readonly order: PublicationOrder) {}

  /**
   * The place of the transaction's events of `pilotId`, taken at its first
   * one: called right after the Pilote's `seq` is incremented, its row locked.
   */
  placeOf(pilotId: string): Place {
    let place = this.places.get(pilotId);
    if (!place) {
      place = this.order.reserve(pilotId);
      this.places.set(pilotId, place);
    }
    return place;
  }

  settle(committed: boolean): void {
    for (const [pilotId, place] of this.places) this.order.settle(pilotId, place, committed);
  }
}

/** The events of each open transaction of `Transactions.run`. */
const eventsByTx = new WeakMap<object, TransactionEvents>();

/** `EventsWriter.write` called with a transaction `Transactions.run` did not open: its events would never be published. */
export class TransactionMissingError extends Error {
  constructor() {
    super('EventsWriter.write needs the transaction client of Transactions.run: an event written elsewhere would never be published.');
    this.name = 'TransactionMissingError';
  }
}

/** Where `EventsWriter` buffers the events of `tx`; throws when `Transactions.run` did not open it. */
export const pendingEventsOf = (tx: object): TransactionEvents => {
  const events = eventsByTx.get(tx);
  if (!events) throw new TransactionMissingError();
  return events;
};

/**
 * Every change of the Process goes through `run` (ADR 0007): its function
 * writes the change and its events (`EventsWriter.write`) with the same `tx`;
 * once the transaction commits, the events are published to the bus, in the
 * order of their `seq` per Pilote (`PublicationOrder`), even across
 * transactions that return out of order. A rollback publishes nothing.
 */
@Injectable()
export class Transactions {
  private readonly order: PublicationOrder;

  constructor(
    private readonly prisma: PrismaService,
    bus: EventsBus,
  ) {
    this.order = new PublicationOrder((pilotId, event) => bus.publish(pilotId, event));
  }

  async run<T>(fn: (tx: Tx) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const events = new TransactionEvents(this.order);
    let committed = false;
    try {
      const result = await this.prisma.scoped.$transaction(async (tx) => {
        eventsByTx.set(tx, events);
        try {
          return await fn(tx);
        } finally {
          eventsByTx.delete(tx);
        }
      }, options);
      committed = true;
      return result;
    } finally {
      events.settle(committed);
    }
  }
}
