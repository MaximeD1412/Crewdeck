import { z } from 'zod';
import { zId, zInstant } from '../values.js';

/** At most this many subscriptions per Pilote are listed (`GET /api/push-subscriptions` is bounded, ADR 0008). */
export const PUSH_SUBSCRIPTIONS_MAX = 20;

/** The label of a subscription, the browser and its system as the page reads them from its user agent (« Safari · iPhone »). */
export const PUSH_LABEL_MAX = 60;

/** The longest endpoint a push service is trusted with (theirs are a few hundred characters). */
export const PUSH_ENDPOINT_MAX = 2048;

/** The hosts of the browsers' push services: Chrome and the Chromium ones (FCM), Firefox (Mozilla), Safari (Apple). */
const PUSH_SERVICE_HOSTS: ReadonlySet<string> = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com']);
/** And the subdomains of these: Safari's `*.push.apple.com`, Edge's `*.notify.windows.com` (WNS). */
const PUSH_SERVICE_DOMAINS = ['.push.apple.com', '.notify.windows.com'] as const;

/**
 * The authority of an `https` URL, a lowercase host and no other port than
 * 443, then its path, query or end: nothing that `URL` would read as
 * credentials, a port or another host (a `@`, a backslash, a tab) gets through.
 */
const HTTPS_HOST = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::443)?(?:[/?#]|$)/;

/**
 * Whether `endpoint` is a browser's push service, the only place the server
 * ever sends a push (ATOI-4): `https` on 443, no credentials, a host of
 * `PUSH_SERVICE_HOSTS` or under `PUSH_SERVICE_DOMAINS`. Any other URL, an
 * address of the server's network included, is refused before it is stored
 * and again before a push (no request of the server's to where a Pilote
 * says). The hosts are the push services' own names: what they resolve to
 * is theirs, not the Pilote's.
 */
export const isPushServiceEndpoint = (endpoint: string): boolean => {
  const host = HTTPS_HOST.exec(endpoint)?.[1];
  if (host === undefined) return false;
  return PUSH_SERVICE_HOSTS.has(host) || PUSH_SERVICE_DOMAINS.some((domain) => host.endsWith(domain));
};

/** A key of `PushSubscription.toJSON().keys`: base64url, without padding. */
const zBase64Url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, 'Base64url attendu');

/**
 * `POST /api/push-subscriptions` (ATOI-4, US-18): what `pushManager.subscribe`
 * gave this browser (its endpoint, an `https` URL of its push service
 * (`isPushServiceEndpoint`), and
 * its keys: `p256dh` the P-256 public key, 65 bytes; `auth` its secret, 16
 * bytes) and its label. An endpoint already known is updated.
 */
export const zPushSubscriptionInput = z.object({
  endpoint: z.url().max(PUSH_ENDPOINT_MAX).refine(isPushServiceEndpoint, 'Service push inconnu'),
  keys: z.object({ p256dh: zBase64Url(86, 88), auth: zBase64Url(22, 24) }),
  label: z.string().trim().min(1).max(PUSH_LABEL_MAX),
});
export type PushSubscriptionInput = z.infer<typeof zPushSubscriptionInput>;

/**
 * A browser that receives the Pilote's push notifications (not an Appareil
 * of ADR 0003: removing it removes the push only). Its endpoint, for the page
 * to know whether it is this browser's; never its keys. The item of `GET
 * /api/push-subscriptions`, of the `push-subscriptions` slice of `GET
 * /api/state` and the payload of `push-subscription.upserted`;
 * `push-subscription.removed` once removed, by the Pilote or by the push
 * service (404, 410).
 */
export const zPushSubscription = z.object({
  id: zId,
  endpoint: z.url(),
  label: z.string().min(1).max(PUSH_LABEL_MAX),
  createdAt: zInstant,
});
export type PushSubscription = z.infer<typeof zPushSubscription>;

/** `GET /api/push-subscriptions` (session): the Pilote's, newest first, at most `PUSH_SUBSCRIPTIONS_MAX`. */
export const zPushSubscriptionList = z.object({ items: z.array(zPushSubscription).max(PUSH_SUBSCRIPTIONS_MAX) });
export type PushSubscriptionList = z.infer<typeof zPushSubscriptionList>;

/**
 * The payload of a push (ADR 0003): a title, the page it opens, and the tag
 * that replaces an earlier notification of the same Décision (its id), or of
 * the batch (`decisions`). No other text.
 */
export const zPushPayload = z.object({
  title: z.string().min(1),
  url: z.string().startsWith('/'),
  tag: z.string().min(1),
});
export type PushPayload = z.infer<typeof zPushPayload>;
