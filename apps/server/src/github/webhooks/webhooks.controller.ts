import { Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { ServerResponse } from 'node:http';
import { headerOf } from '../../auth/auth.request.js';
import type { Env } from '../../config/env.js';
import { ENV } from '../../config/env.module.js';
import { AppError } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { Public } from '../../scope/public.decorator.js';
import { GitHubDeliveries } from './deliveries.js';
import { WebhookDispatcher } from './dispatcher.js';
import { isPayload, type WebhookPayload } from './payload.js';
import type { RawBodyRequest } from './raw-body.js';
import { isSignedBy } from './signature.js';

const badSignature = (): AppError => new AppError(401, 'github.bad-signature', MESSAGES['github.bad-signature']);
const badRequest = (): AppError => new AppError(400, 'http.bad-request', MESSAGES['http.bad-request']);

const reply = (response: ServerResponse, status: 200 | 202, body: object): void => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
};

const parse = (body: Buffer): WebhookPayload => {
  let payload: unknown;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    throw badRequest();
  }
  if (!isPayload(payload)) throw badRequest();
  return payload;
};

/**
 * `POST /api/github/webhooks` (ADR 0002): GitHub's deliveries, straight to
 * the server. Its body is read raw (`readRawBody`) and nothing of it is
 * parsed before `X-Hub-Signature-256` is checked, in constant time: missing
 * or wrong, 401 `github.bad-signature`. Then `ping` gets 200; a delivery id
 * already seen gets 200 `{ duplicate: true }`; any other gets 202 at once
 * (GitHub waits 10 s at most) and is dispatched after (`WebhookDispatcher`).
 */
@Public()
@ApiExcludeController()
@Controller('github/webhooks')
export class WebhooksController {
  private readonly secret: string | undefined;

  constructor(
    @Inject(ENV) env: Env,
    private readonly deliveries: GitHubDeliveries,
    private readonly dispatcher: WebhookDispatcher,
  ) {
    this.secret = env.GITHUB_WEBHOOK_SECRET;
  }

  @Post()
  async receive(@Req() request: RawBodyRequest, @Res() response: ServerResponse): Promise<void> {
    const receivedAt = new Date();
    const body = request.rawBody;
    if (this.secret === undefined || body === undefined || !isSignedBy(this.secret, body, headerOf(request, 'x-hub-signature-256'))) {
      throw badSignature();
    }
    const event = headerOf(request, 'x-github-event');
    const deliveryId = headerOf(request, 'x-github-delivery');
    if (!event || !deliveryId) throw badRequest();
    const payload = parse(body);

    if (event === 'ping') return reply(response, 200, { ok: true });
    if (!(await this.deliveries.record(deliveryId, event, receivedAt))) return reply(response, 200, { duplicate: true });
    this.dispatcher.enqueue({ deliveryId, event, payload, receivedAt });
    reply(response, 202, { accepted: true });
  }
}
