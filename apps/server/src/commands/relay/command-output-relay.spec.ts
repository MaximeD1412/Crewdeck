import type { Hello, RunnerToServer, ServerMessage, ServerToRunner } from '@crewdeck/contracts';
import type { PinoLogger } from 'nestjs-pino';
import { Registry } from '../../realtime/registry.js';
import type { TabMessage, TabMessageHandler, TabSocket } from '../../realtime/ws-tabs.js';
import { RunnerCommands } from '../../runners/runner-commands.service.js';
import { type RunnerLink, RunnerConnections } from '../../runners/runner-connections.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';
import type { RunnerPresence } from '../../runners/runner-presence.service.js';
import { currentPilotId, runInPilotScope } from '../../scope/scope.context.js';
import { CommandRuns } from '../command-runs.service.js';
import { CommandOutputRelay } from './command-output-relay.js';
import type { ProjectSettingsService } from '../../settings/project-settings.js';

const ALICE = 'alice';
const BOB = 'bob';
const RUN = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01';
const BOBS_RUN = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c02';
const B64 = (byte: number, length: number): string => Buffer.alloc(length, byte).toString('base64url');
const WRAP = { holderId: B64(1, 32), enc: B64(2, 32), wrappedKey: B64(3, 48), tag: B64(4, 32) };
const SEALED = { nonce: B64(5, 12), ciphertext: B64(6, 40) };

/** A frame of the Runner, without its envelope's `id` and `at`. */
type FromRunner = Extract<RunnerToServer, { type: 'command.output' | 'command.keys' }> extends infer M ? (M extends unknown ? Omit<M, 'id' | 'at'> : never) : never;

interface Tab extends TabSocket {
  readonly received: ServerMessage[];
}

let tabCount = 0;
const tabOf = (pilotId: string): Tab => {
  tabCount += 1;
  const received: ServerMessage[] = [];
  return { tabId: `019a6b2c-3d4e-7f00-8a1b-${String(tabCount).padStart(12, '0')}`, pilotId, received, send: (message) => received.push(message) };
};

const setup = () => {
  const tabs = new Registry<TabMessageHandler>();
  const connections = new RunnerConnections();
  const dispatcher = new RunnerDispatcher();
  let online = true;
  const presence = { isOnline: () => online } as unknown as RunnerPresence;
  const commands = new RunnerCommands(connections, presence);
  // The owners as PROCESS-12 binds them: a read in the current Pilote's scope.
  const runs: Record<string, string> = { [RUN]: ALICE, [BOBS_RUN]: BOB };
  const owners = { owns: vi.fn(async (pilotId: string, runId: string) => runs[runId] === pilotId && currentPilotId() === pilotId) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
  const relay = new CommandOutputRelay(tabs, owners, commands, connections, dispatcher, logger);
  relay.onModuleInit();

  const sent: ServerToRunner[] = [];
  const link: RunnerLink = { pilotId: ALICE, runnerId: 'runner-1', accepted: true, send: (message) => sent.push(message), close: vi.fn() };
  connections.take(link);
  const [handler] = tabs.all();
  if (!handler) throw new Error('the relay registered no tab handler');

  return {
    runner: { sent },
    logger,
    goOffline: () => {
      online = false;
    },
    goOnline: () => {
      online = true;
      connections.accepted(link, { type: 'hello' } as Hello);
    },
    // The gateway runs a tab's handler in its Pilote's scope.
    tab: (message: TabMessage, tab: Tab) => runInPilotScope(tab.pilotId, () => handler.handle(tab, message)),
    closeTab: (tab: Tab) => handler.closed(tab),
    fromRunner: (message: FromRunner, pilotId = ALICE) =>
      dispatcher.dispatch({ ...message, id: 'm-1', at: '2026-11-17T09:00:00.000Z' } as RunnerToServer, { pilotId, runnerId: 'runner-1', reply: vi.fn() }),
  };
};

const open = (runId = RUN, fromSeq = 1): TabMessage => ({ type: 'command.open', runId, fromSeq });
const output = (seq: number, tabId?: string) => ({ type: 'command.output' as const, runId: RUN, seq, ...SEALED, ...(tabId ? { tabId } : {}) });

describe('CommandOutputRelay', () => {
  it('asks the Runner for the replay of an opened run, to the tab that opened it, then sends it the keys and the live chunks, without their tabId', async () => {
    const s = setup();
    const opener = tabOf(ALICE);
    const other = tabOf(ALICE);
    s.tab(open(RUN, 3), opener);

    await vi.waitFor(() => expect(s.runner.sent).toEqual([expect.objectContaining({ type: 'command.replay', runId: RUN, tabId: opener.tabId, fromSeq: 3 })]));
    await s.fromRunner({ type: 'command.keys', runId: RUN, tabId: opener.tabId, wraps: [WRAP] });
    await s.fromRunner(output(3, opener.tabId));
    await s.fromRunner(output(4));

    expect(opener.received).toEqual([
      { type: 'command.keys', runId: RUN, wraps: [WRAP] },
      { type: 'command.output', runId: RUN, seq: 3, ...SEALED },
      { type: 'command.output', runId: RUN, seq: 4, ...SEALED },
    ]);
    expect(other.received).toEqual([]);
  });

  it('sends a replay chunk only to the tab it names, and a live one to every tab that opened the run', async () => {
    const s = setup();
    const first = tabOf(ALICE);
    const second = tabOf(ALICE);
    s.tab(open(), first);
    s.tab(open(), second);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(2));

    await s.fromRunner(output(1, second.tabId));
    await s.fromRunner(output(2));

    expect(first.received.map((m) => m.type === 'command.output' && m.seq)).toEqual([2]);
    expect(second.received.map((m) => m.type === 'command.output' && m.seq)).toEqual([1, 2]);
  });

  it('answers command.not-found to the open of another Pilote’s run, asks nothing of the Runner, and sends the tab none of its chunks', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(open(BOBS_RUN), tab);
    s.tab(open('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6cff'), tab);

    await vi.waitFor(() =>
      expect(tab.received).toEqual([
        { type: 'command.error', runId: BOBS_RUN, code: 'command.not-found' },
        { type: 'command.error', runId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6cff', code: 'command.not-found' },
      ]),
    );
    await s.fromRunner({ ...output(1), runId: BOBS_RUN });
    await s.fromRunner({ ...output(1), runId: BOBS_RUN }, BOB);
    expect(s.runner.sent).toEqual([]);
    expect(tab.received).toHaveLength(2);
  });

  it('knows by default the runs CommandRuns sent, each its Pilote’s', async () => {
    const connections = new RunnerConnections();
    const link: RunnerLink = { pilotId: ALICE, runnerId: 'runner-1', accepted: true, send: vi.fn(), close: vi.fn() };
    connections.take(link);
    const commands = new RunnerCommands(connections, { isOnline: () => true } as unknown as RunnerPresence);
    const runs = new CommandRuns(commands, { worktreeCommands: async () => null } as unknown as ProjectSettingsService);
    const tabs = new Registry<TabMessageHandler>();
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
    new CommandOutputRelay(tabs, runs, commands, connections, new RunnerDispatcher(), logger).onModuleInit();
    const [handler] = tabs.all();
    await runs.send(ALICE, {
      runId: RUN,
      projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92',
      commandId: 'cmd-tests',
      sealed: { key: B64(9, 60), ciphertext: B64(10, 48) },
      origin: { kind: 'github', owner: 'acme', name: 'shop' },
      integrationBranch: 'develop',
      ref: { stepId: 'deploy', ticket: null, branch: null, sha: null },
    });
    const alice = tabOf(ALICE);
    const bob = tabOf(BOB);
    handler?.handle(alice, open());
    handler?.handle(bob, open());

    await vi.waitFor(() => expect(bob.received).toEqual([{ type: 'command.error', runId: RUN, code: 'command.not-found' }]));
    await vi.waitFor(() => expect(link.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'command.replay', runId: RUN, tabId: alice.tabId })));
    expect(alice.received).toEqual([]);
  });

  it('answers command.runner-offline to an open while the Runner is offline, and replays it once its hello is accepted', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.goOffline();
    s.tab(open(RUN, 2), tab);

    await vi.waitFor(() => expect(tab.received).toEqual([{ type: 'command.error', runId: RUN, code: 'command.runner-offline' }]));
    expect(s.runner.sent).toEqual([]);

    s.goOnline();
    expect(s.runner.sent).toEqual([expect.objectContaining({ type: 'command.replay', runId: RUN, tabId: tab.tabId, fromSeq: 2 })]);
  });

  it('replays, at the Runner’s hello, from the first seq the tab was not sent', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(open(), tab);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(1));
    await s.fromRunner(output(1, tab.tabId));
    await s.fromRunner(output(2));

    s.goOnline();
    expect(s.runner.sent.at(-1)).toEqual(expect.objectContaining({ type: 'command.replay', tabId: tab.tabId, fromSeq: 3 }));
  });

  it('sends nothing more to a tab that closed the run or its socket, nor replays it at the hello', async () => {
    const s = setup();
    const closing = tabOf(ALICE);
    const gone = tabOf(ALICE);
    s.tab(open(), closing);
    s.tab(open(), gone);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(2));
    s.tab({ type: 'command.close', runId: RUN }, closing);
    s.closeTab(gone);
    await vi.waitFor(() => expect(s.logger.debug).toHaveBeenCalledWith(expect.objectContaining({ type: 'command.close' }), 'command relay'));

    await s.fromRunner(output(1));
    s.goOnline();
    expect(closing.received).toEqual([]);
    expect(gone.received).toEqual([]);
    expect(s.runner.sent).toHaveLength(2);
  });

  it('logs a frame by its type and runId, never its content', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(open(), tab);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(1));
    await s.fromRunner(output(1));
    await s.fromRunner({ type: 'command.keys', runId: RUN, wraps: [WRAP] });

    const logger = s.logger as unknown as Record<'debug' | 'info' | 'warn' | 'error', ReturnType<typeof vi.fn>>;
    const logged = JSON.stringify([logger.debug.mock.calls, logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(logged).toContain(RUN);
    for (const secret of [SEALED.nonce, SEALED.ciphertext, WRAP.enc, WRAP.wrappedKey]) expect(logged).not.toContain(secret);
  });
});
