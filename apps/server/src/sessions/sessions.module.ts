import { Module } from '@nestjs/common';
import { RunnerTokens } from '../auth/runner-tokens.js';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { RunnerTokenGuard } from '../devices/runner-token.guard.js';
import { RunnersModule } from '../runners/runners.module.js';
import { SessionRelay } from './relay/session-relay.js';
import { RunnerSessionsController } from './runner-sessions.controller.js';
import { SessionGithubTokens } from './session-github-token.js';
import { SessionHooks } from './session-hooks.js';
import { SessionsController, SessionsState } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

/**
 * The Sessions (RUNNER-9): their rows and events, what the Runner is asked
 * and reports of them, `/api/sessions` and the `sessions` slice. Who starts
 * one (the engine's agent Étapes, RUNNER-12) calls `SessionsService.start` in
 * its transaction, and learns its end through `SessionHooks`. Their content
 * goes between the Runner and the tabs through `SessionRelay` (SESSION-1),
 * sealed, never kept. A request of its agent waiting for the Pilote is a
 * Décision (`requests.ts`, SESSION-3). Its Runner asks for its GitHub token
 * (`/api/runner/sessions/:id/github-token`, RUNNER-10).
 */
@Module({ imports: [RunnersModule, DecisionsModule], controllers: [SessionsController, RunnerSessionsController], providers: [SessionsService, SessionHooks, SessionsState, SessionRelay, SessionGithubTokens, RunnerTokens, RunnerTokenGuard], exports: [SessionsService, SessionHooks] })
export class SessionsModule {}
