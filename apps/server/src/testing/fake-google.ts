import { randomBytes } from 'node:crypto';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import type { GoogleAuthorization, GoogleClient, GoogleCodeExchange, GoogleIdentity } from '../auth/google/google.client.js';
import { codeChallengeOf } from '../auth/oauth-state.js';
import type { Fake } from './fakes.js';

/** The Google account the fake authorize page signs in at once. */
export interface FakeGoogleAccount {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/** A code the fake authorize page drew: what its exchange must prove. */
interface DrawnCode {
  readonly account: FakeGoogleAccount;
  readonly codeChallenge: string;
  readonly nonce: string;
  readonly redirectUri: string;
}

const unavailable = (): AppError => new AppError(500, 'auth.google-unavailable', MESSAGES['auth.google-unavailable']);

/**
 * The fakes' Google (`Fakes.google`), bound to `GOOGLE_CLIENT` by
 * `TestingModule`: its authorize page (`/fake-google/authorize`) signs the
 * seeded account in at once, or comes back with `access_denied` when none
 * is. Its codes serve once, each traded only with the verifier of its
 * challenge, its `redirect_uri` and its nonce, as Google's would.
 */
export class FakeGoogle implements GoogleClient, Fake {
  private account: FakeGoogleAccount | undefined;
  private readonly codes = new Map<string, DrawnCode>();

  /** The account the next sign-ins choose at the fake Google. */
  seedAccount(account: FakeGoogleAccount): void {
    this.account = account;
  }

  reset(): void {
    this.account = undefined;
    this.codes.clear();
  }

  authorizeUrl({ state, codeChallenge, nonce, redirectUri }: GoogleAuthorization): string {
    const query = new URLSearchParams({
      client_id: 'fake',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
      prompt: 'select_account',
    });
    return `/fake-google/authorize?${query.toString()}`;
  }

  /** What the authorize page answers: a code for the seeded account, or `undefined` when there is none (`access_denied`). */
  authorize({ codeChallenge, nonce, redirectUri }: Omit<GoogleAuthorization, 'state'>): string | undefined {
    if (this.account === undefined) return undefined;
    const code = `fake-google-${randomBytes(16).toString('base64url')}`;
    this.codes.set(code, { account: this.account, codeChallenge, nonce, redirectUri });
    return code;
  }

  exchangeCode({ code, codeVerifier, redirectUri, nonce }: GoogleCodeExchange): Promise<GoogleIdentity> {
    const drawn = this.codes.get(code);
    this.codes.delete(code);
    if (drawn === undefined || drawn.codeChallenge !== codeChallengeOf(codeVerifier) || drawn.redirectUri !== redirectUri || drawn.nonce !== nonce) {
      return Promise.reject(unavailable());
    }
    const { sub, email, emailVerified } = drawn.account;
    return Promise.resolve({ sub, email: email.trim().toLowerCase(), emailVerified });
  }
}
