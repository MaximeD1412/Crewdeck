import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** What a sign-in with GitHub carries from `start` to the callback. */
export interface SignInState {
  readonly intent: 'sign-in';
  /** The `state` GitHub sends back: the callback refuses any other. */
  readonly state: string;
  /** The browser's IANA time zone, the new Pilot's. */
  readonly timeZone: string;
  /** The page to land on once signed in. */
  readonly next: string;
}

/** What « Relier GitHub » carries from `link` to the callback: the session's Pilote, whom the callback's session must be. */
export interface LinkState {
  readonly intent: 'link';
  readonly state: string;
  readonly pilotId: string;
  /** The page to come back to, linked or not (`?erreur=`). */
  readonly next: string;
}

/** What the `crewdeck_oauth` cookie carries from `start` or `link` to the shared callback (one callback URL for the App). */
export type OauthState = SignInState | LinkState;

/** A sign-in has 10 minutes to come back. */
export const OAUTH_TTL_SECONDS = 600;

const zState = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('sign-in'), state: z.string().min(1), timeZone: z.string(), next: z.string() }),
  z.object({ intent: z.literal('link'), state: z.string().min(1), pilotId: z.string().min(1), next: z.string() }),
]);
const zExpiry = z.object({ exp: z.number() });

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
  // A cookie sealed before the intents existed is a sign-in's.
  const parsed = zState.safeParse(json !== null && typeof json === 'object' && !('intent' in json) ? { ...json, intent: 'sign-in' } : json);
  const expiry = zExpiry.safeParse(json);
  // zod drops `exp` from the state, as any key it does not declare.
  if (!parsed.success || !expiry.success || expiry.data.exp <= now) return undefined;
  return parsed.data;
};

/** Two states, compared in constant time. */
export const sameState = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const DEFAULT_NEXT = '/a-toi';

/** A path of this site (`/…`, not `//host` nor `/\host`, which browsers read as another site), else `fallback`, `/a-toi`. */
export const safeNext = (next: unknown, fallback = DEFAULT_NEXT): string => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : fallback);

/** `next` with `?erreur=<error>`, which the page it names shows (a failed « Relier GitHub »). */
export const withError = (next: string, error: string): string => {
  const url = new URL(next, 'http://crewdeck.invalid');
  url.searchParams.set('erreur', error);
  return `${url.pathname}${url.search}${url.hash}`;
};

const TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

/** An IANA time zone this runtime knows, else `UTC`. */
export const safeTimeZone = (timeZone: unknown): string => (typeof timeZone === 'string' && TIME_ZONES.has(timeZone) ? timeZone : 'UTC');
