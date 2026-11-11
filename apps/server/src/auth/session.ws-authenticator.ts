import type { IncomingMessage } from 'node:http';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { appOrigin, type Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { WS_AUTHENTICATORS, type WsAuthenticator, type WsAuthenticators } from '../realtime/ws-authenticators.js';
import type { Principal } from '../scope/principal.js';
import { headerOf } from './auth.request.js';
import { readCookie, SESSION_COOKIE } from './cookies.js';
import { WebSessions } from './web-sessions.js';

/**
 * A tab's socket of `/api/ws`: the session cookie, as `SessionMiddleware`
 * reads it, from the page only (its `Origin` the app's): a socket opened by
 * another site with the Pilote's cookie gets nothing.
 */
@Injectable()
export class SessionWsAuthenticator implements WsAuthenticator, OnModuleInit {
  private readonly origin: string;

  constructor(
    @Inject(ENV) env: Env,
    private readonly sessions: WebSessions,
    @Inject(WS_AUTHENTICATORS) private readonly authenticators: WsAuthenticators,
  ) {
    this.origin = appOrigin(env);
  }

  onModuleInit(): void {
    this.authenticators.add(this);
  }

  async authenticate(request: IncomingMessage): Promise<Principal | null> {
    const token = readCookie(headerOf(request, 'cookie'), SESSION_COOKIE);
    if (token === undefined || headerOf(request, 'origin') !== this.origin) return null;
    const session = await this.sessions.find(token);
    return session ? { kind: 'pilot', pilotId: session.pilotId } : null;
  }
}
