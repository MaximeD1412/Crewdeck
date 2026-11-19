import type { Hello, RunnerToServer, ServerToRunner } from '@crewdeck/contracts';
import { AppError } from '../errors/app-error.js';
import { RunnerCommands } from '../runners/runner-commands.service.js';
import { type RunnerLink, RunnerConnections } from '../runners/runner-connections.js';
import { RunnerDispatcher } from '../runners/runner-dispatcher.js';
import type { RunnerPresence } from '../runners/runner-presence.service.js';
import { type CommandRunFinished, CommandRunHooks, type CommandRunStarted } from './command-run-hooks.js';
import { currentPilotId } from '../scope/scope.context.js';
import type { ProjectSettingsService } from '../settings/project-settings.js';
import { type CommandRunRequest, CommandRuns } from './command-runs.service.js';

const RUN = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01';
const B64 = (byte: number, length: number): string => Buffer.alloc(length, byte).toString('base64url');

const request: CommandRunRequest = {
  runId: RUN,
  projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92',
  commandId: 'cmd-tests',
  sealed: { key: B64(9, 60), ciphertext: B64(10, 48) },
  origin: { kind: 'github', owner: 'acme', name: 'shop' },
  integrationBranch: 'develop',
  ref: { stepId: 'tests', ticket: 12, branch: 'feat/12-panier', sha: '3f786850e387550fdab836ed7e6dc881de23001b' },
};

const WORKTREE_COMMANDS = { key: B64(11, 60), ciphertext: B64(12, 40) };

const setup = (online = true, worktreeCommands: { key: string; ciphertext: string } | null = null) => {
  const connections = new RunnerConnections();
  const sent: ServerToRunner[] = [];
  const link: RunnerLink = { pilotId: 'alice', runnerId: 'runner-1', accepted: true, send: (message) => sent.push(message), close: vi.fn() };
  connections.take(link);
  connections.accepted(link, { type: 'hello' } as Hello);
  const asked: { pilotId: string; projectId: string }[] = [];
  const settings = {
    worktreeCommands: async (projectId: string) => {
      asked.push({ pilotId: currentPilotId(), projectId });
      return worktreeCommands;
    },
  } as unknown as ProjectSettingsService;
  const runs = new CommandRuns(new RunnerCommands(connections, { isOnline: () => online } as unknown as RunnerPresence), settings);
  return { runs, sent, asked };
};

describe('CommandRuns', () => {
  it('sends command.run to the Pilote’s Runner, the ids and the sealed part only, and knows the run as theirs', async () => {
    const { runs, sent } = setup();

    await runs.send('alice', request);

    expect(sent).toEqual([{ type: 'command.run', id: expect.any(String), at: expect.any(String), ...request, worktreeCommands: null }]);
    expect(runs.owns('alice', RUN)).toBe(true);
    expect(runs.owns('bob', RUN)).toBe(false);
    expect(runs.owns('alice', '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c02')).toBe(false);
  });

  it('adds the Projet’s worktree Commandes sealed as stored, read in the Pilote’s scope', async () => {
    const { runs, sent, asked } = setup(true, WORKTREE_COMMANDS);

    await runs.send('alice', request);

    expect(asked).toEqual([{ pilotId: 'alice', projectId: request.projectId }]);
    expect(sent).toEqual([expect.objectContaining({ type: 'command.run', runId: RUN, worktreeCommands: WORKTREE_COMMANDS })]);
  });

  it('throws runner.offline (422) with the Runner offline, and does not count the run as sent', async () => {
    const { runs, sent } = setup(false);

    await expect(runs.send('alice', request)).rejects.toThrow(AppError);
    await expect(runs.send('alice', request)).rejects.toThrow(expect.objectContaining({ status: 422, code: 'runner.offline' }));
    expect(sent).toEqual([]);
    expect(runs.owns('alice', RUN)).toBe(false);
  });

  it('sends command.stop', () => {
    const { runs, sent } = setup();

    runs.stop('alice', RUN);

    expect(sent).toEqual([expect.objectContaining({ type: 'command.stop', runId: RUN })]);
  });
});

/** A frame of the Runner, without its envelope's `id` and `at`. */
type FromRunner = RunnerToServer extends infer M ? (M extends unknown ? Omit<M, 'id' | 'at'> : never) : never;

describe('CommandRunHooks', () => {
  const dispatch = (dispatcher: RunnerDispatcher, message: FromRunner) =>
    dispatcher.dispatch({ ...message, id: 'm-1', at: '2026-11-17T09:00:00.000Z' } as RunnerToServer, { pilotId: 'alice', runnerId: 'runner-1', reply: vi.fn() });

  it('calls command-run.started and command-run.finished with the Runner’s Pilote and the verdict’s figures', async () => {
    const dispatcher = new RunnerDispatcher();
    const hooks = new CommandRunHooks(dispatcher);
    hooks.onModuleInit();
    const started: CommandRunStarted[] = [];
    const finished: CommandRunFinished[] = [];
    hooks.onStarted((event) => {
      started.push(event);
    });
    const remove = hooks.onFinished((event) => {
      finished.push(event);
    });

    await dispatch(dispatcher, { type: 'command.started', runId: RUN });
    await dispatch(dispatcher, { type: 'command.verdict', runId: RUN, passed: false, exitCode: 3, reason: 'exited', durationMs: 1200 });
    remove();
    await dispatch(dispatcher, { type: 'command.verdict', runId: RUN, passed: false, exitCode: null, reason: 'timeout', durationMs: 1800000 });

    expect(started).toEqual([{ pilotId: 'alice', runId: RUN }]);
    expect(finished).toEqual([{ pilotId: 'alice', runId: RUN, passed: false, exitCode: 3, reason: 'exited', durationMs: 1200 }]);
  });
});
