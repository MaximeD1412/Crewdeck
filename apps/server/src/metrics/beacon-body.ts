import type { IncomingMessage, ServerResponse } from 'node:http';

/** Where the page reports the latency it measured (CORE-8). */
export const LATENCY_PATH = '/api/metrics/latency';

/** A batch of 100 samples is about 10 kB. */
export const BEACON_BODY_LIMIT = 64 * 1024;

/** A body the parser refuses: rendered by the error filter as body-parser's own errors are (400, 413). */
class BeaconBodyError extends Error {
  readonly expose = true;

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BeaconBodyError';
  }
}

type BeaconRequest = IncomingMessage & { body?: unknown };

/**
 * Reads a `text/plain` body as JSON into `request.body`: what
 * `navigator.sendBeacon` sends on `pagehide` (a string, whose type is
 * CORS-safelisted, where a JSON `Blob` is not everywhere). Any other body is
 * left to the app's JSON parser. Mounted on `LATENCY_PATH` only (`mountApi`).
 */
export const readBeaconBody = (request: BeaconRequest, _response: ServerResponse, next: (error?: unknown) => void): void => {
  if (!/^text\/plain\b/i.test(request.headers['content-type'] ?? '')) return next();
  const chunks: Buffer[] = [];
  let size = 0;
  let failed = false;
  const fail = (error: unknown): void => {
    if (failed) return;
    failed = true;
    chunks.length = 0;
    // The rest is read and dropped, so that the error reaches the client.
    request.resume();
    next(error);
  };
  request.on('data', (chunk: Buffer) => {
    if (failed) return;
    size += chunk.length;
    if (size > BEACON_BODY_LIMIT) return fail(new BeaconBodyError(413, 'The beacon body is over 64 kB'));
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (failed) return;
    try {
      request.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return fail(new BeaconBodyError(400, 'The beacon body is not JSON'));
    }
    next();
  });
  request.on('error', fail);
};
