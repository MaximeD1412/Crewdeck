import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** What a sign-in carries from `start` to the callback, in the `crewdeck_oauth` cookie. */
export interface OauthState {
  /** The `state` GitHub sends back: the callback refuses any other. */
  readonly state: string;
  /** The browser's IANA time zone, the new Pilot's. */
  readonly timeZone: string;
  /** The page to land on once signed in. */
  readonly next: string;
}

/** A sign-in has 10 minutes to come back. */
export const OAUTH_TTL_SECONDS = 600;

const zSigned = z.object({ state: z.string().min(1), timeZone: z.string(), next: z.string(), exp: z.number() });

const sign = (secret: Buffer, body: string): Buffer => createHmac('sha256', secret).update(body).digest();

export const newState = (): string => randomBytes(32).toString('base64url');

/** `base64url(JSON) . base64url(HMAC-SHA256)` with `SESSION_SECRET`, valid 10 minutes from `now`. */
export const sealOauthState = (secret: Buffer, value: OauthState, now = Date.now()): string => {
  const body = Buffer.from(JSON.stringify({ ...value, exp: now + OAUTH_TTL_SECONDS * 1000 })).toString('base64url');
  return `${body}.${sign(secret, body).toString('base64url')}`;
};

/** The state sealed in `cookie`, if this secret signed it and it has not expired at `now`. */
export const openOauthState = (secret: Buffer, cookie: string | undefined, now = Date.now()): OauthState | undefined => {
  const [body, mac, ...rest] = cookie?.split('.') ?? [];
  if (!body || !mac || rest.length > 0) return undefined;
  const expected = sign(secret, body);
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = zSigned.safeParse(json);
  if (!parsed.success || parsed.data.exp <= now) return undefined;
  const { state, timeZone, next } = parsed.data;
  return { state, timeZone, next };
};

/** Two states, compared in constant time. */
export const sameState = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const DEFAULT_NEXT = '/a-toi';

/** A path of this site (`/…`, not `//host` nor `/\host`, which browsers read as another site), else `/a-toi`. */
export const safeNext = (next: unknown): string => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : DEFAULT_NEXT);

const TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

/** An IANA time zone this runtime knows, else `UTC`. */
export const safeTimeZone = (timeZone: unknown): string => (typeof timeZone === 'string' && TIME_ZONES.has(timeZone) ? timeZone : 'UTC');
