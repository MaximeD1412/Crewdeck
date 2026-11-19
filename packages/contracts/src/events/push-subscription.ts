import { type PushSubscription, zPushSubscription } from '../api/push-subscriptions.js';
import { registerEventPayload } from './index.js';

/**
 * `push-subscription.upserted`: a subscription as `GET /api/push-subscriptions`
 * lists it, when a browser subscribes; `push-subscription.removed` when the
 * Pilote removes it or its push service says it is gone.
 */
export const zPushSubscriptionEventPayload = registerEventPayload('push-subscription', zPushSubscription);

declare module './index.js' {
  interface EventPayloads {
    'push-subscription': PushSubscription;
  }
}
