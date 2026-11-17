import type { Hello, RunnerToServer, ServerMessage, ServerToRunner } from '@crewdeck/contracts';
import type { PinoLogger } from 'nestjs-pino';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { Registry } from '../../realtime/registry.js';
import type { TabMessage, TabMessageHandler, TabSocket } from '../../realtime/ws-tabs.js';
import { RunnerCommands } from '../../runners/runner-commands.service.js';
import { type RunnerLink, RunnerConnections } from '../../runners/runner-connections.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';
import type { RunnerPresence } from '../../runners/runner-presence.service.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { SessionRelay } from './session-relay.js';

const ALICE = 'alice';
const BOB = 'bob';
const SESSION = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a91';
const BOBS_SESSION = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01';
const INPUT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aa2';
const B64 = (byte: number, length: number): string => Buffer.alloc(length, byte).toString('base64url');
const WRAP = { holderId: B64(1, 32), enc: B64(2, 32), wrappedKey: B64(3, 48), tag: B64(4, 32) };
const SEALED = { nonce: B64(5, 12), ciphertext: B64(6, 40) };

/** A frame of the Runner, without its envelope's `id` and `at`. */
type FromRunner = Extract<RunnerToServer, { type: 'relay' | 'session.keys' }> extends infer M ? (M extends unknown ? Omit<M, 'id' | 'at'> : never) : never;

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
  const sessions: Record<string, string> = { [SESSION]: ALICE, [BOBS_SESSION]: BOB };
  // The scoped read of a Session: only the current Pilote's.
  const prisma = {
    scoped: {
      agentSession: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (sessions[where.id] === currentPilotId() ? { id: where.id } : null)),
      },
    },
  } as unknown as PrismaService;
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
  const relay = new SessionRelay(tabs, prisma, new RunnerCommands(connections, presence), connections, dispatcher, logger);
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
    tab: (message: TabMessage, tab: Tab) => handler.handle(tab, message),
    closeTab: (tab: Tab) => handler.closed(tab),
    fromRunner: (message: FromRunner, pilotId = ALICE) =>
      dispatcher.dispatch({ ...message, id: 'm-1', at: '2026-11-16T09:00:00.000Z' } as RunnerToServer, { pilotId, runnerId: 'runner-1', reply: vi.fn() }),
  };
};

const open = (sessionId = SESSION, fromSeq = 1): TabMessage => ({ type: 'session.open', sessionId, fromSeq });
const relayFrame = (seq: number, tabId?: string) => ({ type: 'relay' as const, sessionId: SESSION, seq, ...SEALED, ...(tabId ? { tabId } : {}) });

describe('SessionRelay', () => {
  it('asks the Runner for the replay of an opened Session, to the tab that opened it only, then sends it the live frames, without their tabId', async () => {
    const s = setup();
    const opener = tabOf(ALICE);
    const other = tabOf(ALICE);
    s.tab(open(SESSION, 3), opener);

    await vi.waitFor(() => expect(s.runner.sent).toEqual([expect.objectContaining({ type: 'session.replay', sessionId: SESSION, tabId: opener.tabId, fromSeq: 3 })]));
    await s.fromRunner({ type: 'session.keys', sessionId: SESSION, tabId: opener.tabId, wraps: [WRAP] });
    await s.fromRunner(relayFrame(3, opener.tabId));
    await s.fromRunner(relayFrame(4));

    expect(opener.received).toEqual([
      { type: 'session.keys', sessionId: SESSION, wraps: [WRAP] },
      { type: 'relay', sessionId: SESSION, seq: 3, ...SEALED },
      { type: 'relay', sessionId: SESSION, seq: 4, ...SEALED },
    ]);
    expect(other.received).toEqual([]);
  });

  it('sends a replay frame only to the tab it names, and a live one to every tab that opened the Session', async () => {
    const s = setup();
    const first = tabOf(ALICE);
    const second = tabOf(ALICE);
    s.tab(open(), first);
    s.tab(open(), second);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(2));

    await s.fromRunner(relayFrame(1, second.tabId));
    await s.fromRunner(relayFrame(2));

    expect(first.received.map((m) => m.type === 'relay' && m.seq)).toEqual([2]);
    expect(second.received.map((m) => m.type === 'relay' && m.seq)).toEqual([1, 2]);
  });

  it('answers session.not-found to the open of another Pilote’s Session, asks nothing of the Runner, and sends the tab none of its frames', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(open(BOBS_SESSION), tab);

    await vi.waitFor(() => expect(tab.received).toEqual([{ type: 'session.error', sessionId: BOBS_SESSION, code: 'session.not-found' }]));
    await s.fromRunner({ ...relayFrame(1), sessionId: BOBS_SESSION });
    await s.fromRunner({ ...relayFrame(1), sessionId: BOBS_SESSION }, BOB);
    expect(s.runner.sent).toEqual([]);
    expect(tab.received).toHaveLength(1);
  });

  it('sends the Pilote’s input to the Runner with the tab’s tabId, and refuses one for another Pilote’s Session', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    const input = { type: 'session.input' as const, sessionId: SESSION, inputId: INPUT, ...SEALED };
    s.tab(input, tab);
    s.tab({ ...input, sessionId: BOBS_SESSION }, tab);

    await vi.waitFor(() => expect(tab.received).toEqual([{ type: 'session.error', sessionId: BOBS_SESSION, code: 'session.not-found' }]));
    expect(s.runner.sent).toEqual([expect.objectContaining({ ...input, tabId: tab.tabId })]);
  });

  it('answers session.runner-offline to an open and an input while the Runner is offline, and replays the open once its hello is accepted', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.goOffline();
    s.tab(open(SESSION, 2), tab);
    s.tab({ type: 'session.input', sessionId: SESSION, inputId: INPUT, ...SEALED }, tab);

    await vi.waitFor(() =>
      expect(tab.received).toEqual([
        { type: 'session.error', sessionId: SESSION, code: 'session.runner-offline' },
        { type: 'session.error', sessionId: SESSION, code: 'session.runner-offline' },
      ]),
    );
    expect(s.runner.sent).toEqual([]);

    s.goOnline();
    expect(s.runner.sent).toEqual([expect.objectContaining({ type: 'session.replay', sessionId: SESSION, tabId: tab.tabId, fromSeq: 2 })]);
  });

  it('replays, at the Runner’s hello, from the first seq the tab was not sent', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(open(), tab);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(1));
    await s.fromRunner(relayFrame(1, tab.tabId));
    await s.fromRunner(relayFrame(2));

    s.goOnline();
    expect(s.runner.sent.at(-1)).toEqual(expect.objectContaining({ type: 'session.replay', tabId: tab.tabId, fromSeq: 3 }));
  });

  it('replays, at the Runner’s hello, from the first seq missing below a live frame that came during the replay', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(open(), tab);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(1));
    // Seq 3 live, while the replay has sent seq 1 only: the Runner goes away before seq 2.
    await s.fromRunner(relayFrame(3));
    await s.fromRunner(relayFrame(1, tab.tabId));

    s.goOnline();
    expect(s.runner.sent.at(-1)).toEqual(expect.objectContaining({ type: 'session.replay', tabId: tab.tabId, fromSeq: 2 }));
    // The replay sends seq 2, then seq 3 again: the next hello asks from 4.
    await s.fromRunner(relayFrame(2, tab.tabId));
    await s.fromRunner(relayFrame(3, tab.tabId));
    s.goOnline();
    expect(s.runner.sent.at(-1)).toEqual(expect.objectContaining({ type: 'session.replay', tabId: tab.tabId, fromSeq: 4 }));
  });

  it('sends nothing more to a tab that closed the Session or its socket, nor replays it at the hello', async () => {
    const s = setup();
    const closing = tabOf(ALICE);
    const gone = tabOf(ALICE);
    s.tab(open(), closing);
    s.tab(open(), gone);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(2));
    s.tab({ type: 'session.close', sessionId: SESSION }, closing);
    s.closeTab(gone);
    await vi.waitFor(() => expect(s.logger.debug).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.close' }), 'session relay'));

    await s.fromRunner(relayFrame(1));
    s.goOnline();
    expect(closing.received).toEqual([]);
    expect(gone.received).toEqual([]);
    expect(s.runner.sent).toHaveLength(2);
  });

  it('handles a tab’s messages in order: a close, or the socket closed, right after an open leaves the tab following nothing', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    const gone = tabOf(ALICE);
    s.tab(open(), tab);
    s.tab({ type: 'session.close', sessionId: SESSION }, tab);
    s.tab(open(), gone);
    s.closeTab(gone);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(1));

    await s.fromRunner(relayFrame(1));
    expect(tab.received).toEqual([]);
    expect(gone.received).toEqual([]);
  });

  it('logs a frame by its type and sessionId, never its content', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(open(), tab);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(1));
    await s.fromRunner(relayFrame(1));
    await s.fromRunner({ type: 'session.keys', sessionId: SESSION, wraps: [WRAP] });

    const logged = JSON.stringify(vi.mocked(s.logger.debug).mock.calls);
    expect(logged).toContain(SESSION);
    for (const secret of [SEALED.nonce, SEALED.ciphertext, WRAP.enc, WRAP.wrappedKey]) expect(logged).not.toContain(secret);
  });
});
