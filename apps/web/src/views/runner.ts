import type { AiAccount, Runner } from '@crewdeck/contracts';
import type { ComposantData, PageRunner } from '@crewdeck/sdk';
import { engineAccounts, loginCommand } from './ai-accounts.js';

export type RunnerView = ComposantData<typeof PageRunner>;

export interface RunnerState {
  /** The `runner` slice. */
  readonly runner: Runner | null;
  /** The `ai-account` slice. */
  readonly accounts: Iterable<AiAccount>;
}

/**
 * « Runner et Comptes IA »'s data (pure): both Moteurs as the Runner reported
 * them, the command of the first one not connected (Claude Code's once all
 * are), and the Runner's machine and state.
 */
export const runnerView = ({ runner, accounts }: RunnerState): RunnerView => {
  const engines = engineAccounts(accounts);
  const notConnected = engines.find((engine) => engine.state !== 'connected' || engine.kind === 'none');
  return {
    engines,
    command: notConnected?.command ?? loginCommand('claude-code'),
    runner: runner
      ? {
          machine: runner.machine,
          os: runner.os,
          arch: runner.arch,
          wsl: runner.wsl,
          runnerVersion: runner.runnerVersion,
          state: runner.state,
          lastSeenAt: runner.lastSeenAt,
        }
      : null,
  };
};
