import webpush from 'web-push';
import type { Env } from './env.js';

/** The token of the server's `VapidKeys`: `@Inject(VAPID) private readonly vapid: VapidKeys`. */
export const VAPID = Symbol('VAPID');

/** The VAPID key pair of Web Push (ATOI-4) and its subject, as `web-push` takes them. */
export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

/** The subject of a server without one: a URL that is nobody's. */
const LOCAL_SUBJECT = 'https://crewdeck.invalid';

/**
 * The deployed servers have their keys (`parseEnv` requires them); a local
 * server without them draws a pair at each boot: a restart then ends the
 * subscriptions of its browsers (their push services refuse the new key),
 * which subscribe again from the Paramètres.
 */
export const vapidKeys = (env: Env): VapidKeys => {
  if (env.VAPID_PUBLIC_KEY !== undefined && env.VAPID_PRIVATE_KEY !== undefined) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? LOCAL_SUBJECT };
  }
  const drawn = webpush.generateVAPIDKeys();
  return { publicKey: drawn.publicKey, privateKey: drawn.privateKey, subject: env.VAPID_SUBJECT ?? LOCAL_SUBJECT };
};
