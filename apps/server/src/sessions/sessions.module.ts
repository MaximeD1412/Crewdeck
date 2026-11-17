import { Module } from '@nestjs/common';
import { RunnersModule } from '../runners/runners.module.js';
import { SessionRelay } from './relay/session-relay.js';
import { SessionHooks } from './session-hooks.js';
import { SessionsController, SessionsState } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

/**
 * The Sessions (RUNNER-9): their rows and events, what the Runner is asked
 * and reports of them, `/api/sessions` and the `sessions` slice. Who starts
 * one (the engine's agent Étapes, RUNNER-12) calls `SessionsService.start` in
 * its transaction, and learns its end through `SessionHooks`. Their content
 * goes between the Runner and the tabs through `SessionRelay` (SESSION-1),
 * sealed, never kept.
 */
@Module({ imports: [RunnersModule], controllers: [SessionsController], providers: [SessionsService, SessionHooks, SessionsState, SessionRelay], exports: [SessionsService, SessionHooks] })
export class SessionsModule {}
