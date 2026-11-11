import { createHmac, timingSafeEqual } from 'node:crypto';

/** `X-Hub-Signature-256`'s shape: `sha256=` and 32 bytes in lowercase hex. */
const SIGNATURE = /^sha256=([0-9a-f]{64})$/;

/**
 * Whether `signature` (`X-Hub-Signature-256`) is the HMAC-SHA256 of `body`
 * with `secret`, compared in constant time (`timingSafeEqual`, risk SEC-8).
 * A header of another shape says nothing about the secret: refused before
 * any comparison.
 */
export const isSignedBy = (secret: string, body: Buffer, signature: string | undefined): boolean => {
  const hex = signature === undefined ? undefined : SIGNATURE.exec(signature)?.[1];
  if (hex === undefined) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(hex, 'hex'));
};
