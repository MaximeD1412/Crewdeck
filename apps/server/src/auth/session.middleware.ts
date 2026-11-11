import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { appOrigin, type Env, isDeployed } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { type AuthRequest, type AuthResponse, headerOf } from './auth.request.js';
import { readCookie, SESSION_COOKIE, serializeCookie } from './cookies.js';
import { SESSION_TTL_SECONDS, WebSessions } from './web-sessions.js';

/** The methods that change nothing: no Origin check for them. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Before every route: the `crewdeck_session` cookie gives the request its
 * principal (`ScopeGuard` then lets it in, `ScopeInterceptor` opens its
 * Pilote's scope). No CSRF token: the cookie is `SameSite=Lax`, and a
 * request that changes something with it must come from the page, its
 * `Origin` the app's, else 401 `auth.origin`. Without the cookie nothing is
 * checked: the webhooks and the Runner do not come from the page. When the
 * session's expiry slides, the cookie is set again for 30 days: a Pilote who
 * comes back every day stays signed in.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware<AuthRequest> {
  private readonly origin: string;
  private readonly secure: boolean;

  constructor(
    @Inject(ENV) env: Env,
    private readonly sessions: WebSessions,
  ) {
    this.origin = appOrigin(env);
    this.secure = isDeployed(env);
  }

  async use(request: AuthRequest, response: AuthResponse, next: (error?: unknown) => void): Promise<void> {
    try {
      const token = readCookie(headerOf(request, 'cookie'), SESSION_COOKIE);
      if (token === undefined) return next();
      if (!SAFE_METHODS.has(request.method ?? 'GET') && headerOf(request, 'origin') !== this.origin) {
        throw new AppError(401, 'auth.origin', MESSAGES['auth.origin']);
      }
      const session = await this.sessions.find(token);
      if (session) {
        if (session.slid) {
          response.appendHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS, path: '/', secure: this.secure }));
        }
        request.webSession = { id: session.id, pilotId: session.pilotId };
        request.principal = { kind: 'pilot', pilotId: session.pilotId };
      }
      next();
    } catch (error) {
      next(error);
    }
  }
}
