import type { AiAccount, McpServer, ProjectProcess, Runner } from '@crewdeck/contracts';
import type { ComposantData, PageRunner } from '@crewdeck/sdk';
import { attachedToText, mcpAttachmentsOf } from '../process/mcp-attachments.js';
import { engineAccounts, loginCommand } from './ai-accounts.js';

export type RunnerView = ComposantData<typeof PageRunner>;

export interface RunnerState {
  /** The `runner` slice. */
  readonly runner: Runner | null;
  /** The `ai-account` slice. */
  readonly accounts: Iterable<AiAccount>;
  /** The `mcp-server` slice: as the Runner last reported them, kept while it is offline. */
  readonly mcpServers: Iterable<McpServer>;
  /** The `process` slice: where each server is attached; without it, unknown. */
  readonly processes?: Iterable<ProjectProcess>;
  /** A Projet's name by its id: a Local Projet's is sealed, the page opens it. */
  readonly projectName?: (projectId: string) => string;
}

/**
 * « Runner et Comptes IA »'s data (pure): both Moteurs as the Runner reported
 * them, the command of the first one not connected (Claude Code's once all
 * are), the Runner's machine and state, and its Serveurs MCP by name, each
 * with the Étapes attaching it in every Projet (`mcp-attachments.ts`).
 */
export const runnerView = ({ runner, accounts, mcpServers, processes, projectName = (id) => id }: RunnerState): RunnerView => {
  const attachments = processes ? mcpAttachmentsOf(processes, projectName) : null;
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
    mcpServers: [...mcpServers]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ name, transport, state, toolCount }) => ({ name, transport, state, toolCount, attachedTo: attachments ? attachedToText(attachments.get(name)) : null })),
  };
};
