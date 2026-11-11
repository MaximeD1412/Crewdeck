import type { IncomingMessage, ServerResponse } from 'node:http';

/** Where GitHub posts the App's webhooks (ADR 0002). */
export const WEBHOOKS_PATH = '/api/github/webhooks';

/** GitHub caps a delivery's payload at 25 MB. */
export const WEBHOOK_BODY_LIMIT = 25 * 1024 * 1024;

/** The webhook's request, its body as GitHub sent it. */
export type RawBodyRequest = IncomingMessage & { rawBody?: Buffer };

/** A body over the limit: rendered by the error filter as body-parser's own errors are (413). */
class BodyTooLargeError extends Error {
  readonly expose = true;
  readonly status = 413;

  constructor() {
    super('The webhook body is over 25 MB');
    this.name = 'BodyTooLargeError';
  }
}

/**
 * Reads the webhook's body as bytes into `rawBody`, before the app's JSON
 * parser (which then finds the request read and skips it): the signature is
 * the HMAC of these bytes, and nothing is parsed before it is checked.
 * Mounted on `WEBHOOKS_PATH` only (`mountApi`).
 */
export const readRawBody = (request: RawBodyRequest, _response: ServerResponse, next: (error?: unknown) => void): void => {
  const chunks: Buffer[] = [];
  let size = 0;
  let failed = false;
  request.on('data', (chunk: Buffer) => {
    if (failed) return;
    size += chunk.length;
    if (size > WEBHOOK_BODY_LIMIT) {
      failed = true;
      chunks.length = 0;
      // The rest is read and dropped, so that the 413 reaches the client.
      request.resume();
      next(new BodyTooLargeError());
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (failed) return;
    request.rawBody = Buffer.concat(chunks);
    next();
  });
  request.on('error', (error) => {
    if (failed) return;
    failed = true;
    next(error);
  });
};
