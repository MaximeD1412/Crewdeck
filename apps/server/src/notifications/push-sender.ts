import { isPushServiceEndpoint, type PushPayload } from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import webpush from 'web-push';
import { VAPID, type VapidKeys } from '../config/vapid.js';
import type { PushTarget } from './push-subscriptions.js';

/** What became of a push: delivered to the push service, the subscription gone (404, 410), or failed otherwise (kept, tried again next time). */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/** How long a push service keeps a push for a browser that is offline: a day, after which the Décision is no news. */
const TTL_SECONDS = 24 * 60 * 60;

/** How long a push service may keep the socket of a send silent before it fails: well under a push's claim (`PUSH_CLAIM_MS`). */
export const PUSH_SEND_TIMEOUT_MS = 30_000;

/** Sends one push to one browser: the boundary with the push services, which the tests replace. */
export abstract class PushSender {
  abstract send(target: PushTarget, payload: PushPayload): Promise<PushOutcome>;
}

/**
 * The sender of `CREWDECK_ENV=test` (the integration tests): no push service
 * is ever requested from a test, even by a timer a test left running.
 */
@Injectable()
export class InertPushSender extends PushSender {
  send(): Promise<PushOutcome> {
    return Promise.resolve('failed');
  }
}

/**
 * Web Push (ADR 0007, RFC 8291 and 8292, `web-push`): the payload encrypted
 * with the browser's keys, signed with the server's VAPID keys. Only to a
 * push service (`isPushServiceEndpoint`, checked again here): any other
 * endpoint is never requested, its subscription gone. Neither the endpoint
 * nor the payload is logged.
 */
@Injectable()
export class WebPushSender extends PushSender {
  constructor(
    @Inject(VAPID) private readonly vapid: VapidKeys,
    @InjectPinoLogger(WebPushSender.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
    if (!isPushServiceEndpoint(target.endpoint)) return 'gone';
    try {
      await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
        TTL: TTL_SECONDS,
        urgency: 'high',
        timeout: PUSH_SEND_TIMEOUT_MS,
      });
      return 'sent';
    } catch (error) {
      const status = error instanceof webpush.WebPushError ? error.statusCode : undefined;
      if (status === 404 || status === 410) return 'gone';
      this.logger.warn({ subscriptionId: target.id, status, err: status === undefined ? error : undefined }, 'push failed');
      return 'failed';
    }
  }
}
