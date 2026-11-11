import { Controller, Get, HttpCode, Inject, Post, Query, Redirect, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PinoLogger } from 'nestjs-pino';
import { appOrigin, type Env, isDeployed } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { AppError } from '../errors/app-error.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github/github.client.js';
import { GitHubInstallations } from '../github/webhooks/installations.js';
import { newId } from '../ids.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../scope/public.decorator.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { SESSION_SECRET } from './auth.keys.js';
import { type AuthRequest, type AuthResponse, headerOf } from './auth.request.js';
import { clearCookie, OAUTH_COOKIE, OAUTH_COOKIE_PATH, readCookie, SESSION_COOKIE, serializeCookie } from './cookies.js';
import { GithubTokens } from './github-tokens.js';
import { newState, OAUTH_TTL_SECONDS, openOauthState, safeNext, safeTimeZone, sameState, sealOauthState } from './oauth-state.js';
import { SESSION_TTL_SECONDS, WebSessions } from './web-sessions.js';

/** Why a sign-in failed, as `/connexion?erreur=` names it (the `PageConnexion`'s `error`). */
type SignInError = 'state-mismatch' | 'denied' | 'github-unavailable';

interface Redirection {
  readonly url: string;
  readonly statusCode: 302;
}

const to = (url: string): Redirection => ({ url, statusCode: 302 });
const failed = (error: SignInError): Redirection => to(`/connexion?erreur=${error}`);

/**
 * Sign-in with GitHub (US-1), which is also the sign-up: the first callback
 * of a GitHub user creates their Pilot. GitHub's user authorization (ADR
 * 0002) gives the tokens the page reads GitHub with; the server keeps them
 * encrypted and opens a `WebSession` for the browser.
 */
@Public()
@ApiExcludeController()
@Controller('auth')
export class AuthController {
  private readonly secure: boolean;
  private readonly callbackUrl: string;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(SESSION_SECRET) private readonly secret: Buffer,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly prisma: PrismaService,
    private readonly sessions: WebSessions,
    private readonly tokens: GithubTokens,
    private readonly installations: GitHubInstallations,
    private readonly logger: PinoLogger,
  ) {
    this.secure = isDeployed(env);
    this.callbackUrl = `${appOrigin(env)}/api/auth/github/callback`;
    logger.setContext('AuthController');
  }

  /** `GET /api/auth/github/start?timeZone&next`: to GitHub's authorize page, the sign-in's state in a signed cookie. */
  @Get('github/start')
  @Redirect()
  start(@Res({ passthrough: true }) response: AuthResponse, @Query('timeZone') timeZone?: string, @Query('next') next?: string): Redirection {
    const state = newState();
    const sealed = sealOauthState(this.secret, { state, timeZone: safeTimeZone(timeZone), next: safeNext(next) });
    response.appendHeader('Set-Cookie', serializeCookie(OAUTH_COOKIE, sealed, { maxAge: OAUTH_TTL_SECONDS, path: OAUTH_COOKIE_PATH, secure: this.secure }));
    return to(this.github.authorizeUrl(state, this.callbackUrl));
  }

  /** `GET /api/auth/github/callback?code&state` (or `?error`): GitHub sends the browser back here. */
  @Get('github/callback')
  @Redirect()
  async callback(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthResponse,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<Redirection> {
    const sealed = openOauthState(this.secret, readCookie(headerOf(request, 'cookie'), OAUTH_COOKIE));
    response.appendHeader('Set-Cookie', clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH, secure: this.secure }));
    if (error !== undefined) return failed(error === 'access_denied' ? 'denied' : 'github-unavailable');
    if (!sealed || !code || !state || !sameState(state, sealed.state)) return failed('state-mismatch');

    let token: string;
    try {
      token = await this.signIn(code, sealed.timeZone, headerOf(request, 'user-agent'));
    } catch (failure) {
      if (!(failure instanceof AppError)) throw failure;
      this.logger.warn({ code: failure.code }, 'Sign-in with GitHub failed');
      return failed('github-unavailable');
    }
    response.appendHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS, path: '/', secure: this.secure }));
    return to(sealed.next);
  }

  /** `POST /api/auth/logout` → 204: the browser's session ends, its cookie is cleared. */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: AuthResponse): Promise<void> {
    const session = request.webSession;
    if (session) await runInPilotScope(session.pilotId, () => this.sessions.close(session.id));
    response.appendHeader('Set-Cookie', clearCookie(SESSION_COOKIE, { path: '/', secure: this.secure }));
  }

  /**
   * The GitHub user of `code` as a Pilot (created, or their login and avatar
   * refreshed), the installations of the App they made before linked to them,
   * their tokens stored, a session opened.
   */
  private async signIn(code: string, timeZone: string, userAgent: string | undefined): Promise<string> {
    const tokens = await this.github.exchangeCode(code, this.callbackUrl);
    const user = await this.github.getAuthenticatedUser(tokens.accessToken);
    const pilot = await this.prisma.scoped.pilot.upsert({
      where: { githubUserId: BigInt(user.id) },
      create: { id: newId(), githubUserId: BigInt(user.id), login: user.login, avatarUrl: user.avatarUrl, timeZone },
      update: { login: user.login, avatarUrl: user.avatarUrl },
      select: { id: true },
    });
    await this.installations.linkPendingTo(pilot.id, user.id);
    return runInPilotScope(pilot.id, () =>
      this.prisma.scoped.$transaction(async (tx) => {
        await this.tokens.store(tx, pilot.id, tokens);
        return this.sessions.open(tx, pilot.id, userAgent);
      }),
    );
  }
}
