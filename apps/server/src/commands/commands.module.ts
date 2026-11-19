import { Module } from '@nestjs/common';
import { RunnersModule } from '../runners/runners.module.js';
import { CommandRunHooks } from './command-run-hooks.js';
import { COMMAND_RUN_OWNERS, CommandRuns } from './command-runs.service.js';
import { CommandOutputRelay } from './relay/command-output-relay.js';

/**
 * The Commandes run on the Runner (RUNNER-18, ADR 0013): what the Runner is
 * asked (`CommandRuns`), what it reports (`CommandRunHooks`), and the relay
 * of their output to the tabs (`CommandOutputRelay`), sealed, never kept.
 * The `command` kind of the engine, `command_runs` and its Décisions are
 * PROCESS-12's.
 */
@Module({
  imports: [RunnersModule],
  providers: [CommandRuns, CommandRunHooks, CommandOutputRelay, { provide: COMMAND_RUN_OWNERS, useExisting: CommandRuns }],
  exports: [CommandRuns, CommandRunHooks, COMMAND_RUN_OWNERS],
})
export class CommandsModule {}
