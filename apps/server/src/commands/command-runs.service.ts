import type { RunnerMessageOf, SealedItem } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { RunnerCommands } from '../runners/runner-commands.service.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { ProjectSettingsService } from '../settings/project-settings.js';

/** A `command.run` as its caller gives it: the message without its envelope, nor the Projet's worktree Commandes `send` adds. */
export type CommandRunRequest = Omit<RunnerMessageOf<'command.run'>, 'type' | 'id' | 'at' | 'worktreeCommands'>;

/**
 * Who says which Pilote a run is (the relay of its output asks it before a
 * tab follows the run): PROCESS-12 binds it to `command_runs`; until then
 * `CommandRuns` answers with the runs it sent.
 */
export interface CommandRunOwners {
  owns(pilotId: string, runId: string): boolean | Promise<boolean>;
}

export const COMMAND_RUN_OWNERS = Symbol('COMMAND_RUN_OWNERS');

/**
 * The Commandes asked of the Pilote's Runner (RUNNER-18, ADR 0013): a
 * `command.run` carries the ids, the version's sealed part as it is stored
 * and the Ticket under judgement, never a text to run; the Runner opens the
 * sealed part and runs what it holds. Sent through `RunnerCommands`: a
 * Runner offline is a 422 `runner.offline`, nothing queued.
 *
 * It keeps, in memory, which Pilote each run it sent is: the default
 * `COMMAND_RUN_OWNERS`.
 */
@Injectable()
export class CommandRuns implements CommandRunOwners {
  /** runId → pilotId, the runs sent since the process started. */
  private readonly sent = new Map<string, string>();

  constructor(
    private readonly commands: RunnerCommands,
    private readonly settings: ProjectSettingsService,
  ) {}

  async send(pilotId: string, run: CommandRunRequest): Promise<void> {
    const worktreeCommands: SealedItem | null = await runInPilotScope(pilotId, () => this.settings.worktreeCommands(run.projectId));
    this.commands.send(pilotId, { type: 'command.run', ...run, worktreeCommands });
    this.sent.set(run.runId, pilotId);
  }

  /** The run's group gets SIGTERM, then SIGKILL; its verdict says `stopped`. */
  stop(pilotId: string, runId: string): void {
    this.commands.send(pilotId, { type: 'command.stop', runId });
  }

  owns(pilotId: string, runId: string): boolean {
    return this.sent.get(runId) === pilotId;
  }
}
