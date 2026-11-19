import type { CommandRunReason } from '@crewdeck/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RunnerDispatcher } from '../runners/runner-dispatcher.js';

/** `command-run.started`: the run's process started on the Runner. */
export interface CommandRunStarted {
  readonly pilotId: string;
  readonly runId: string;
}

/** `command-run.finished`: the run's verdict, its figures only (ADR 0003). */
export interface CommandRunFinished {
  readonly pilotId: string;
  readonly runId: string;
  readonly passed: boolean;
  readonly exitCode: number | null;
  readonly reason: CommandRunReason;
  readonly durationMs: number;
}

type Hook<T> = (event: T) => void | Promise<void>;

/**
 * Who learns, in-process, what the Runner reports of a run (RUNNER-18): its
 * `command.started` (`command-run.started`) and its `command.verdict`
 * (`command-run.finished`). PROCESS-12's `command` kind registers here and
 * stores them; nothing is written here. A hook runs in the scope of the
 * Runner's Pilote; its failure is the handler's.
 */
@Injectable()
export class CommandRunHooks implements OnModuleInit {
  private readonly startedHooks = new Set<Hook<CommandRunStarted>>();
  private readonly finishedHooks = new Set<Hook<CommandRunFinished>>();

  constructor(private readonly dispatcher: RunnerDispatcher) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('command.started', ({ runId }, { pilotId }) => this.call(this.startedHooks, { pilotId, runId }));
    this.dispatcher.registerRunnerHandler('command.verdict', ({ runId, passed, exitCode, reason, durationMs }, { pilotId }) =>
      this.call(this.finishedHooks, { pilotId, runId, passed, exitCode, reason, durationMs }),
    );
  }

  /** Calls `hook` on each `command-run.started`; returns its removal. */
  onStarted(hook: Hook<CommandRunStarted>): () => void {
    this.startedHooks.add(hook);
    return () => this.startedHooks.delete(hook);
  }

  /** Calls `hook` on each `command-run.finished`; returns its removal. */
  onFinished(hook: Hook<CommandRunFinished>): () => void {
    this.finishedHooks.add(hook);
    return () => this.finishedHooks.delete(hook);
  }

  private async call<T>(hooks: Set<Hook<T>>, event: T): Promise<void> {
    for (const hook of [...hooks]) await hook(event);
  }
}
