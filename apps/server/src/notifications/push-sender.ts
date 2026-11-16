import type { PushPayload } from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import webpush from 'web-push';
import { VAPID, type VapidKeys } from '../config/vapid.js';
import type { PushTarget } from './push-subscriptions.js';

/** What became of a push: delivered to the push service, the subscription gone (404, 410), or failed otherwise (kept, tried again next time). */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/** How long a push service keeps a push for a browser that is offline: a day, after which the Décision is no news. */
const TTL_SECONDS = 24 * 60 * 60;

/** Sends one push to one browser: the boundary with the push services, which the tests replace. */
export abstract class PushSender {
  abstract send(target: PushTarget, payload: PushPayload): Promise<PushOutcome>;
}

/**
 * Web Push (ADR 0007, RFC 8291 and 8292, `web-push`): the payload encrypted
 * with the browser's keys, signed with the server's VAPID keys. Neither the
 * endpoint nor the payload is logged.
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
    try {
      await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
        TTL: TTL_SECONDS,
        urgency: 'high',
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
