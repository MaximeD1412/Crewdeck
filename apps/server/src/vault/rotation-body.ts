import type { IncomingMessage, ServerResponse } from 'node:http';
import { VAULT_ROTATION_BODY_MAX_BYTES } from '@crewdeck/contracts';

/** Where a page and the Runner post a rotation of the vault key (E2E-4). */
export const VAULT_ROTATION_PATHS = ['/api/vault/rotations', '/api/runner/vault/rotations'];

/** A body the reader refuses: rendered by the error filter as body-parser's own errors are (400, 413). */
class RotationBodyError extends Error {
  readonly expose = true;

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RotationBodyError';
  }
}

/** `_body` tells the app's JSON parser the body was read already. */
type RotationRequest = IncomingMessage & { body?: unknown; _body?: boolean };

/**
 * Reads a rotation's JSON body, up to `VAULT_ROTATION_BODY_MAX_BYTES` (every
 * item key rewrapped, about 150 bytes each), where the app's parser stops at
 * `JSON_BODY_LIMIT`. Mounted on `VAULT_ROTATION_PATHS` only (`mountApi`).
 */
export const readRotationBody = (request: RotationRequest, _response: ServerResponse, next: (error?: unknown) => void): void => {
  if (request.method !== 'POST' || !/^application\/json\b/i.test(request.headers['content-type'] ?? '')) return next();
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
    if (size > VAULT_ROTATION_BODY_MAX_BYTES) return fail(new RotationBodyError(413, 'The rotation body is over 10 MB'));
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (failed) return;
    try {
      request.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      request._body = true;
    } catch {
      return fail(new RotationBodyError(400, 'The rotation body is not JSON'));
    }
    next();
  });
  request.on('error', fail);
};
