import { Controller, Get, Inject, Optional, Query, Redirect, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PinoLogger } from 'nestjs-pino';
import { appOrigin, type Env, isDeployed } from '../../config/env.js';
import { ENV } from '../../config/env.module.js';
import { AppError } from '../../errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Public } from '../../scope/public.decorator.js';
import { SESSION_SECRET } from '../auth.keys.js';
import { type AuthRequest, type AuthResponse, headerOf } from '../auth.request.js';
import { clearCookie, GOOGLE_OAUTH_COOKIE_PATH, OAUTH_COOKIE, readCookie, SESSION_COOKIE, serializeCookie } from '../cookies.js';
import { isUniqueViolation, PilotIdentities } from '../identities.js';
import {
  codeChallengeOf,
  newCodeVerifier,
  newState,
  OAUTH_TTL_SECONDS,
  openOauthState,
  safeNext,
  safeTimeZone,
  sameState,
  sealOauthState,
} from '../oauth-state.js';
import { failed, type Redirection, to } from '../sign-in-redirect.js';
import { SESSION_TTL_SECONDS, WebSessions } from '../web-sessions.js';
import { GOOGLE_CLIENT, type GoogleClient, type GoogleIdentity } from './google.client.js';

/**
 * Sign-in with Google (US-1, ADR 0014), which is also the sign-up: OpenID
 * Connect with PKCE, a verified address required. Its Pilote is the one of
 * the Google account, else the one whose link or Google account has the same
 * address, else a new one. Nothing from Google is kept but its `sub` and the
 * address; the server opens a `WebSession` for the browser.
 */
@Public()
@ApiExcludeController()
@Controller('auth/google')
export class GoogleAuthController {
  private readonly secure: boolean;
  private readonly callbackUrl: string;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(SESSION_SECRET) private readonly secret: Buffer,
    @Optional() @Inject(GOOGLE_CLIENT) private readonly google: GoogleClient | undefined,
    private readonly prisma: PrismaService,
    private readonly sessions: WebSessions,
    private readonly identities: PilotIdentities,
    private readonly logger: PinoLogger,
  ) {
    this.secure = isDeployed(env);
    this.callbackUrl = `${appOrigin(env)}/api/auth/google/callback`;
    logger.setContext('GoogleAuthController');
  }

  /** `GET /api/auth/google/start?timeZone&next`: to Google's authorize page, the state, the verifier and the nonce in a signed cookie. */
  @Get('start')
  @Redirect()
  start(@Res({ passthrough: true }) response: AuthResponse, @Query('timeZone') timeZone?: string, @Query('next') next?: string): Redirection {
    if (!this.google) return failed('google-unavailable');
    const state = newState();
    const codeVerifier = newCodeVerifier();
    const nonce = newState();
    const sealed = sealOauthState(this.secret, { intent: 'sign-in', state, timeZone: safeTimeZone(timeZone), next: safeNext(next), codeVerifier, nonce });
    response.appendHeader('Set-Cookie', serializeCookie(OAUTH_COOKIE, sealed, { maxAge: OAUTH_TTL_SECONDS, path: GOOGLE_OAUTH_COOKIE_PATH, secure: this.secure }));
    return to(this.google.authorizeUrl({ state, codeChallenge: codeChallengeOf(codeVerifier), nonce, redirectUri: this.callbackUrl }));
  }

  /** `GET /api/auth/google/callback?code&state` (or `?error`): Google sends the browser back here. */
  @Get('callback')
  @Redirect()
  async callback(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthResponse,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<Redirection> {
    const sealed = openOauthState(this.secret, readCookie(headerOf(request, 'cookie'), OAUTH_COOKIE));
    response.appendHeader('Set-Cookie', clearCookie(OAUTH_COOKIE, { path: GOOGLE_OAUTH_COOKIE_PATH, secure: this.secure }));
    if (error !== undefined) return failed(error === 'access_denied' ? 'denied' : 'google-unavailable');
    if (sealed?.intent !== 'sign-in' || !sealed.codeVerifier || !sealed.nonce || !code || !state || !sameState(state, sealed.state)) return failed('state-mismatch');
    if (!this.google) return failed('google-unavailable');

    let identity: GoogleIdentity;
    try {
      identity = await this.google.exchangeCode({ code, codeVerifier: sealed.codeVerifier, redirectUri: this.callbackUrl, nonce: sealed.nonce });
    } catch (failure) {
      if (!(failure instanceof AppError)) throw failure;
      this.logger.warn({ code: failure.code }, 'Sign-in with Google failed');
      return failed('google-unavailable');
    }
    if (!identity.emailVerified) return failed('google-unverified');

    const token = await this.signIn(identity, sealed.timeZone, headerOf(request, 'user-agent'));
    response.appendHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS, path: '/', secure: this.secure }));
    return to(sealed.next);
  }

  /** The Pilote of the Google account (`PilotIdentities.signInByAddress`), a session opened for them. */
  private async signIn({ sub, email }: GoogleIdentity, timeZone: string, userAgent: string | undefined): Promise<string> {
    const attempt = (): Promise<string> =>
      this.prisma.unscoped.$transaction(async (tx) => {
        const pilotId = await this.identities.signInByAddress(tx, { provider: 'google', subject: sub, email }, timeZone);
        return this.sessions.open(tx, pilotId, userAgent);
      });
    // Two first sign-ins of one Google account at once: the loser rolled back; once more finds the Pilote.
    return attempt().catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      return attempt();
    });
  }
}
