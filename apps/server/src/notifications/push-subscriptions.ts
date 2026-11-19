import { PUSH_SUBSCRIPTIONS_MAX, type PushSubscription, type PushSubscriptionInput, zId } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { AppError, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { Prisma } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { EventsWriter } from '../realtime/events.writer.js';
import type { Tx } from '../realtime/transactions.js';

/** What of a `push_subscriptions` row the page sees: never its keys, nor when it was last pushed. */
const SUBSCRIPTION_VIEW = { id: true, endpoint: true, label: true, createdAt: true } as const;

/** Where a push goes: a subscription's endpoint and keys. */
export interface PushTarget {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

const toSubscription = (row: { id: string; endpoint: string; label: string; createdAt: Date }): PushSubscription => ({
  id: row.id,
  endpoint: row.endpoint,
  label: row.label,
  createdAt: row.createdAt.toISOString(),
});

const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const missing = (): AppError => notFound('push-subscription.not-found', MESSAGES['push-subscription.not-found']);

/**
 * The browsers that receive the Pilote's push notifications (ATOI-4, US-18),
 * in the Pilote's scope: each change writes its `push-subscription.*` event
 * in its `tx` (ADR 0007). An endpoint belongs to one browser, so to one
 * Pilote: another account's is refused, never moved.
 */
@Injectable()
export class PushSubscriptions {
  constructor(private readonly events: EventsWriter) {}

  /** The Pilote's, newest first, at most `PUSH_SUBSCRIPTIONS_MAX`. */
  async list(tx: Tx): Promise<PushSubscription[]> {
    const rows = await tx.pushSubscription.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PUSH_SUBSCRIPTIONS_MAX, select: SUBSCRIPTION_VIEW });
    return rows.map(toSubscription);
  }

  /** Subscribes the browser of `input.endpoint`, or updates its keys and its label when it already is. */
  async upsert(tx: Tx, pilotId: string, input: PushSubscriptionInput): Promise<PushSubscription> {
    await this.events.lock(tx, pilotId);
    const values = { p256dh: input.keys.p256dh, auth: input.keys.auth, label: input.label };
    const known = await tx.pushSubscription.findFirst({ where: { endpoint: input.endpoint }, select: { id: true } });
    let row;
    if (known) {
      row = await tx.pushSubscription.update({ where: { id: known.id }, data: values, select: SUBSCRIPTION_VIEW });
    } else {
      if ((await tx.pushSubscription.count()) >= PUSH_SUBSCRIPTIONS_MAX) {
        throw unprocessable('push-subscription.too-many', MESSAGES['push-subscription.too-many']);
      }
      try {
        row = await tx.pushSubscription.create({ data: { id: newId(), pilotId, endpoint: input.endpoint, ...values }, select: SUBSCRIPTION_VIEW });
      } catch (error) {
        if (isUniqueViolation(error)) throw new AppError(409, 'push-subscription.taken', MESSAGES['push-subscription.taken']);
        throw error;
      }
    }
    const subscription = toSubscription(row);
    await this.events.write(tx, pilotId, 'push-subscription.upserted', subscription);
    return subscription;
  }

  /** Removes the Pilote's subscription `id`: 404 when it is not theirs, or no longer is. */
  async remove(tx: Tx, pilotId: string, id: string): Promise<void> {
    if (!zId.safeParse(id).success) throw missing();
    if (!(await this.removed(tx, pilotId, id))) throw missing();
  }

  /** Removes `id` if it is still there (its push service said it is gone): whether it was. */
  async removed(tx: Tx, pilotId: string, id: string): Promise<boolean> {
    const { count } = await tx.pushSubscription.deleteMany({ where: { id } });
    if (count === 0) return false;
    await this.events.write(tx, pilotId, 'push-subscription.removed', { id });
    return true;
  }

  /** Where the Pilote's pushes go: every subscription. */
  targets(tx: Tx): Promise<PushTarget[]> {
    return tx.pushSubscription.findMany({ select: { id: true, endpoint: true, p256dh: true, auth: true }, orderBy: { createdAt: 'asc' } });
  }

  /** Notes that `ids` were just pushed to. */
  async pushed(tx: Tx, ids: readonly string[], at: Date): Promise<void> {
    if (ids.length > 0) await tx.pushSubscription.updateMany({ where: { id: { in: [...ids] } }, data: { lastPushedAt: at } });
  }
}
