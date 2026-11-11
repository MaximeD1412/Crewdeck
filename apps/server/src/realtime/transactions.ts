import type { Event } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { PrismaService, type ScopedPrisma } from '../prisma/prisma.service.js';
import { EventsBus } from './events.bus.js';

/** The client of an interactive transaction of `prisma.scoped`: what a change and its events are written with. */
export type Tx = Parameters<Parameters<ScopedPrisma['$transaction']>[0]>[0];

export interface TransactionOptions {
  readonly isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

/** An event written in a transaction, published once it commits. */
export interface PendingEvent {
  readonly pilotId: string;
  readonly event: Event;
}

/** The events each open transaction of `Transactions.run` has written so far. */
const pendingByTx = new WeakMap<object, PendingEvent[]>();

/** `EventsWriter.write` called with a transaction `Transactions.run` did not open: its events would never be published. */
export class TransactionMissingError extends Error {
  constructor() {
    super('EventsWriter.write needs the transaction client of Transactions.run: an event written elsewhere would never be published.');
    this.name = 'TransactionMissingError';
  }
}

/** Where `EventsWriter` buffers the events of `tx`; throws when `Transactions.run` did not open it. */
export const pendingEventsOf = (tx: object): PendingEvent[] => {
  const pending = pendingByTx.get(tx);
  if (!pending) throw new TransactionMissingError();
  return pending;
};

/**
 * Every change of the Process goes through `run` (ADR 0007): its function
 * writes the change and its events (`EventsWriter.write`) with the same `tx`;
 * once the transaction commits, the events are published to the bus, in the
 * order they were written. A rollback publishes nothing.
 */
@Injectable()
export class Transactions {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventsBus,
  ) {}

  async run<T>(fn: (tx: Tx) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const pending: PendingEvent[] = [];
    const result = await this.prisma.scoped.$transaction(async (tx) => {
      pendingByTx.set(tx, pending);
      try {
        return await fn(tx);
      } finally {
        pendingByTx.delete(tx);
      }
    }, options);
    for (const { pilotId, event } of pending) this.bus.publish(pilotId, event);
    return result;
  }
}
