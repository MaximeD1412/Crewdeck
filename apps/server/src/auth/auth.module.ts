import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { ENV } from '../config/env.module.js';
import { AuthController } from './auth.controller.js';
import { SESSION_SECRET, sessionSecret, tokenCipher } from './auth.keys.js';
import { GithubTokenController } from './github-token.controller.js';
import { GithubTokens } from './github-tokens.js';
import { SessionMiddleware } from './session.middleware.js';
import { SessionWsAuthenticator } from './session.ws-authenticator.js';
import { TokenCipher } from './token-cipher.js';
import { WebSessions } from './web-sessions.js';

/** Sign-in with GitHub, the browser's sessions (and their sockets, CORE-5), the Pilote's GitHub tokens (CORE-4). */
@Module({
  controllers: [AuthController, GithubTokenController],
  providers: [
    WebSessions,
    GithubTokens,
    SessionMiddleware,
    SessionWsAuthenticator,
    { provide: SESSION_SECRET, inject: [ENV], useFactory: sessionSecret },
    { provide: TokenCipher, inject: [ENV], useFactory: tokenCipher },
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}

