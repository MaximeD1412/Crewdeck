import { Module } from '@nestjs/common';
import { RunnerTokens } from '../auth/runner-tokens.js';
import { RunnerClock } from './clock.js';
import { RunnerCommands } from './runner-commands.service.js';
import { RunnerConnections } from './runner-connections.js';
import { RunnerDispatcher } from './runner-dispatcher.js';
import { RunnerPresence } from './runner-presence.service.js';
import { RunnerSweep } from './runner-sweep.job.js';
import { RunnerState, RunnersController } from './runners.controller.js';
import { RunnersGateway } from './runners.gateway.js';
import { RunnerProtocol } from './protocol-version.js';

/**
 * The Pilote's Runner (ADR 0004): its socket (`RunnersGateway`, a client of
 * `/api/ws`), its presence, the commands sent to it, `GET /api/runner`.
 */
@Module({
  controllers: [RunnersController],
  providers: [RunnerTokens, RunnerClock, RunnerProtocol, RunnerConnections, RunnerDispatcher, RunnerPresence, RunnerSweep, RunnerCommands, RunnersGateway, RunnerState],
  exports: [RunnerPresence, RunnerCommands, RunnerDispatcher, RunnerClock],
})
export class RunnersModule {}
