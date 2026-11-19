import { z } from 'zod';
import { AppError } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';

/** The token of the `GoogleClient`: `@Inject(GOOGLE_CLIENT) private readonly google: GoogleClient`. */
export const GOOGLE_CLIENT = Symbol('GOOGLE_CLIENT');

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** The issuers of Google's `id_token`, as its OpenID Connect guide lists them. */
const ISSUERS: ReadonlySet<string> = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** How long the token request may take before the sign-in gives up. */
const TIMEOUT_MS = 10_000;

/** What sends a sign-in to Google's authorize page. */
export interface GoogleAuthorization {
  readonly state: string;
  /** The S256 challenge of the verifier sealed in the browser's cookie (PKCE). */
  readonly codeChallenge: string;
  /** What the `id_token` must carry back. */
  readonly nonce: string;
  readonly redirectUri: string;
}

/** What Google's callback gives back to trade. */
export interface GoogleCodeExchange {
  readonly code: string;
  /** The verifier whose challenge went to the authorize page. */
  readonly codeVerifier: string;
  readonly redirectUri: string;
  /** The nonce sent to the authorize page: an `id_token` with another is refused. */
  readonly nonce: string;
}

/** Who signed in with Google: nothing else is kept, not even a token. */
export interface GoogleIdentity {
  /** Google's account id, which stays when the address changes. */
  readonly sub: string;
  /** Lower-cased. */
  readonly email: string;
  readonly emailVerified: boolean;
}

/**
 * The sign-in with Google (ADR 0014): OpenID Connect, the authorization code
 * with PKCE, scopes `openid email`. Google only says who signs in: Crewdeck
 * asks no `profile`, keeps no token. Every failure of Google, or an
 * `id_token` whose claims do not hold, is a 500 `auth.google-unavailable`.
 */
export interface GoogleClient {
  /** Google's authorize page, which comes back to `redirectUri` with `code` and `state` (or `error`). */
  authorizeUrl(authorization: GoogleAuthorization): string;
  exchangeCode(exchange: GoogleCodeExchange): Promise<GoogleIdentity>;
}

export interface GoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** What the client logs: why Google failed, never an address nor a token. */
export interface GoogleLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

const zTokenResponse = z.object({ id_token: z.string().min(1) });

/** `email_verified` is a boolean; a string `"true"` is read too. */
const zVerified = z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).optional();

const zClaims = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  sub: z.string().min(1),
  email: z.string().min(3),
  email_verified: zVerified,
  nonce: z.string().optional(),
});

/** Why an `id_token` was refused, for the log. */
class RefusedToken extends Error {}

const unavailable = (): AppError => new AppError(500, 'auth.google-unavailable', MESSAGES['auth.google-unavailable']);

/** The payload of a JWT, unverified: it comes straight from Google's token endpoint over TLS, with the client secret. */
const payloadOf = (jwt: string): unknown => {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) throw new RefusedToken('not-a-jwt');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new RefusedToken('not-a-jwt');
  }
};

/**
 * Google's own endpoints through `fetch`. The `id_token`'s signature is not
 * checked: Google's guide allows it when the token comes from the token
 * endpoint itself; its issuer, audience, expiry and nonce are.
 */
export class OidcGoogleClient implements GoogleClient {
  constructor(
    private readonly credentials: GoogleCredentials,
    private readonly logger: GoogleLogger,
    private readonly now: () => number = Date.now,
  ) {}

  authorizeUrl({ state, codeChallenge, nonce, redirectUri }: GoogleAuthorization): string {
    const query = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
      prompt: 'select_account',
    });
    return `${GOOGLE_AUTHORIZE_URL}?${query.toString()}`;
  }

  async exchangeCode({ code, codeVerifier, redirectUri, nonce }: GoogleCodeExchange): Promise<GoogleIdentity> {
    let body: unknown;
    try {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = (body as { error?: unknown } | null)?.error;
        this.logger.warn({ status: response.status, error: typeof error === 'string' ? error : null }, 'Google refused the code');
        throw unavailable();
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.warn({ reason: (error as Error).name }, 'Google did not answer');
      throw unavailable();
    }
    try {
      return this.identityOf(body, nonce);
    } catch (error) {
      if (!(error instanceof RefusedToken)) throw error;
      this.logger.warn({ reason: error.message }, 'Google’s id_token refused');
      throw unavailable();
    }
  }

  private identityOf(body: unknown, nonce: string): GoogleIdentity {
    const response = zTokenResponse.safeParse(body);
    if (!response.success) throw new RefusedToken('no-id-token');
    const parsed = zClaims.safeParse(payloadOf(response.data.id_token));
    if (!parsed.success) throw new RefusedToken('claims-malformed');
    const claims = parsed.data;
    if (!ISSUERS.has(claims.iss)) throw new RefusedToken('issuer');
    const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
    if (!audiences.includes(this.credentials.clientId)) throw new RefusedToken('audience');
    if (claims.exp * 1000 <= this.now()) throw new RefusedToken('expired');
    if (claims.nonce !== nonce) throw new RefusedToken('nonce');
    return { sub: claims.sub, email: claims.email.trim().toLowerCase(), emailVerified: claims.email_verified ?? false };
  }
}
