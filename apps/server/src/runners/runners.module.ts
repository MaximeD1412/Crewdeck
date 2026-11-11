import { Module } from '@nestjs/common';
import { RunnerTokens } from '../auth/runner-tokens.js';
import { DevicesModule } from '../devices/devices.module.js';
import { AiAccounts, AiAccountsController, AiAccountState } from './ai-accounts/ai-accounts.js';
import { RunnerClock } from './clock.js';
import { RunnerDistController } from './distribution/runner-dist.controller.js';
import { RunnerLinkLimiter } from './link/link-limiter.js';
import { RunnerLinkLookup } from './link/link-lookup.js';
import { RunnerLinkTokens } from './link/link-tokens.js';
import { RunnerLinkCodesController, RunnerLinkController, RunnerLinkState } from './link/runner-link.controller.js';
import { RunnerLinkSweep } from './link/runner-link-sweep.job.js';
import { RunnerLinks } from './link/runner-links.service.js';
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
 * `/api/ws`), its presence, the commands sent to it, `GET /api/runner`,
 * its link (`link/`, RUNNER-3), and what each Moteur can run on it
 * (`ai-accounts/`, RUNNER-7).
 */
@Module({
  imports: [DevicesModule],
  controllers: [RunnersController, AiAccountsController, RunnerLinkCodesController, RunnerLinkController, RunnerDistController],
  providers: [
    RunnerTokens,
    RunnerClock,
    RunnerProtocol,
    RunnerConnections,
    RunnerDispatcher,
    RunnerPresence,
    RunnerSweep,
    RunnerCommands,
    RunnersGateway,
    RunnerState,
    RunnerLinkLookup,
    RunnerLinkLimiter,
    RunnerLinkTokens,
    RunnerLinks,
    RunnerLinkSweep,
    RunnerLinkState,
    AiAccounts,
    AiAccountState,
  ],
  exports: [RunnerPresence, RunnerCommands, RunnerDispatcher, RunnerClock],
})
export class RunnersModule {}
