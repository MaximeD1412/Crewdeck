import { zPushSubscription, type PushSubscription, type PushSubscriptionInput } from '@crewdeck/contracts';
import type { Client } from './client.js';

/**
 * Subscribes this browser (`POST /api/push-subscriptions`, ATOI-4), or updates
 * it: the resource, whose `push-subscription.upserted` the store gets too. 409
 * when another account receives on it, 422 past 20 browsers.
 */
export const addPushSubscription = (client: Pick<Client, 'command'>, input: PushSubscriptionInput): Promise<PushSubscription> =>
  client.command('POST', '/api/push-subscriptions', input, zPushSubscription);

/** Stops the pushes to a browser (`DELETE /api/push-subscriptions/:id`); 404 once it is gone. */
export const removePushSubscription = (client: Pick<Client, 'command'>, id: string): Promise<void> =>
  client.command('DELETE', `/api/push-subscriptions/${encodeURIComponent(id)}`, {});
