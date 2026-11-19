import { Controller, Get, HttpCode, Inject, Post, Query, Redirect, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PinoLogger } from 'nestjs-pino';
import { appOrigin, type Env, isDeployed } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { AppError } from '../errors/app-error.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github/github.client.js';
import { GitHubInstallations } from '../github/webhooks/installations.js';
import { publishMe } from '../pilots/me.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions } from '../realtime/transactions.js';
import { Public } from '../scope/public.decorator.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { SESSION_SECRET } from './auth.keys.js';
import { type AuthRequest, type AuthResponse, headerOf } from './auth.request.js';
import { clearCookie, OAUTH_COOKIE, OAUTH_COOKIE_PATH, readCookie, SESSION_COOKIE, serializeCookie } from './cookies.js';
import { GithubLinks } from './github-links.js';
import { GithubTokens } from './github-tokens.js';
import { isUniqueViolation, PilotIdentities } from './identities.js';
import { newState, OAUTH_TTL_SECONDS, openOauthState, safeNext, safeTimeZone, sameState, sealOauthState, withError } from './oauth-state.js';
import { failed, type Redirection, to } from './sign-in-redirect.js';
import { SESSION_TTL_SECONDS, WebSessions } from './web-sessions.js';

/** The App's one callback URL (INFRA-11), for the sign-in and « Relier GitHub » alike. */
export const githubCallbackUrl = (env: Env): string => `${appOrigin(env)}/api/auth/github/callback`;

/**
 * Sign-in with GitHub (US-1), which is also the sign-up: the first callback
 * of a GitHub user creates their Pilot and its `github` Identité (ADR 0014). GitHub's user authorization (ADR
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
    private readonly identities: PilotIdentities,
    private readonly links: GithubLinks,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly logger: PinoLogger,
  ) {
    this.secure = isDeployed(env);
    this.callbackUrl = githubCallbackUrl(env);
    logger.setContext('AuthController');
  }

  /** `GET /api/auth/github/start?timeZone&next`: to GitHub's authorize page, the sign-in's state in a signed cookie. */
  @Get('github/start')
  @Redirect()
  start(@Res({ passthrough: true }) response: AuthResponse, @Query('timeZone') timeZone?: string, @Query('next') next?: string): Redirection {
    const state = newState();
    const sealed = sealOauthState(this.secret, { intent: 'sign-in', state, timeZone: safeTimeZone(timeZone), next: safeNext(next) });
    response.appendHeader('Set-Cookie', serializeCookie(OAUTH_COOKIE, sealed, { maxAge: OAUTH_TTL_SECONDS, path: OAUTH_COOKIE_PATH, secure: this.secure }));
    return to(this.github.authorizeUrl(state, this.callbackUrl));
  }

  /**
   * `GET /api/auth/github/callback?code&state` (or `?error`): GitHub sends the
   * browser back here, after a sign-in or a « Relier GitHub » (the sealed
   * `intent`). A link needs its state and the very session that started it,
   * else `state-mismatch`, GitHub's error included; then its failures come
   * back to its page, `<next>?erreur=<case>`.
   */
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
    const refused = error === undefined ? undefined : error === 'access_denied' ? 'denied' : 'github-unavailable';
    if (sealed?.intent === 'link') {
      // The state and the very session first: GitHub's error too comes back to the page only for the link that started it.
      if (!state || !sameState(state, sealed.state) || request.webSession?.pilotId !== sealed.pilotId) return failed('state-mismatch');
      if (refused) return to(withError(sealed.next, refused));
      if (!code) return failed('state-mismatch');
      const linkError = await this.links.link(sealed.pilotId, code, this.callbackUrl);
      return to(linkError ? withError(sealed.next, linkError) : sealed.next);
    }
    if (refused) return failed(refused);
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
   * The GitHub user of `code` as a Pilot (created with their `github`
   * Identité, or their displayName, login and avatar refreshed), the installations of the App they made before linked to them,
   * their tokens stored (and `pilot.upserted` when they had none: a Pilote
   * who had to reconnect GitHub), a session opened.
   */
  private async signIn(code: string, timeZone: string, userAgent: string | undefined): Promise<string> {
    const tokens = await this.github.exchangeCode(code, this.callbackUrl);
    const user = await this.github.getAuthenticatedUser(tokens.accessToken);
    const subject = String(user.id);
    const pilotOfUser = (): Promise<string> => this.prisma.unscoped.$transaction(async (tx) => {
      const known = await this.identities.pilotOf('github', subject, tx);
      if (!known) {
        return this.identities.signUp(tx, {
          provider: 'github',
          subject,
          email: null,
          login: user.login,
          displayName: user.login,
          timeZone,
          avatarUrl: user.avatarUrl,
        });
      }
      await tx.pilot.update({ where: { id: known }, data: { displayName: user.login, avatarUrl: user.avatarUrl } });
      await tx.pilotIdentity.updateMany({ where: { provider: 'github', subject }, data: { login: user.login } });
      return known;
    });
    // Two first sign-ins of one GitHub user at once: the second sign-up lost the
    // race on the Identité and rolled back; once more finds the Pilote.
    const pilotId = await pilotOfUser().catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      return pilotOfUser();
    });
    await this.installations.linkPendingTo(pilotId, user.id);
    return runInPilotScope(pilotId, () =>
      this.transactions.run(async (tx) => {
        // The tokens of a Pilote who had to reconnect GitHub: their tabs show it linked again.
        const reconnected = (await tx.githubUserToken.count()) === 0;
        await this.tokens.store(tx, pilotId, tokens);
        if (reconnected) await publishMe(tx, this.events, pilotId);
        return this.sessions.open(tx, pilotId, userAgent);
      }),
    );
  }
}
