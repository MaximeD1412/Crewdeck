import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { appOrigin, type Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { type AuthRequest, headerOf } from './auth.request.js';
import { readCookie, SESSION_COOKIE } from './cookies.js';
import { WebSessions } from './web-sessions.js';

/** The methods that change nothing: no Origin check for them. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Before every route: the `crewdeck_session` cookie gives the request its
 * principal (`ScopeGuard` then lets it in, `ScopeInterceptor` opens its
 * Pilote's scope). No CSRF token: the cookie is `SameSite=Lax`, and a
 * request that changes something with it must come from the page, its
 * `Origin` the app's, else 401 `auth.origin`. Without the cookie nothing is
 * checked: the webhooks and the Runner do not come from the page.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware<AuthRequest> {
  private readonly origin: string;

  constructor(
    @Inject(ENV) env: Env,
    private readonly sessions: WebSessions,
  ) {
    this.origin = appOrigin(env);
  }

  async use(request: AuthRequest, _response: unknown, next: (error?: unknown) => void): Promise<void> {
    try {
      const token = readCookie(headerOf(request, 'cookie'), SESSION_COOKIE);
      if (token === undefined) return next();
      if (!SAFE_METHODS.has(request.method ?? 'GET') && headerOf(request, 'origin') !== this.origin) {
        throw new AppError(401, 'auth.origin', MESSAGES['auth.origin']);
      }
      const session = await this.sessions.find(token);
      if (session) {
        request.webSession = session;
        request.principal = { kind: 'pilot', pilotId: session.pilotId };
      }
      next();
    } catch (error) {
      next(error);
    }
  }
}
