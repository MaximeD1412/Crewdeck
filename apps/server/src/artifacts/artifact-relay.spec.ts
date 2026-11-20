import { ARTIFACT_TIMEOUT_SECONDS, type Hello, type RunnerToServer, type ServerMessage, type ServerToRunner } from '@crewdeck/contracts';
import type { PinoLogger } from 'nestjs-pino';
import type { CommandRunOwners } from '../commands/command-runs.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { Registry } from '../realtime/registry.js';
import type { TabMessage, TabMessageHandler, TabSocket } from '../realtime/ws-tabs.js';
import { RunnerCommands } from '../runners/runner-commands.service.js';
import { type RunnerLink, RunnerConnections } from '../runners/runner-connections.js';
import { RunnerDispatcher } from '../runners/runner-dispatcher.js';
import type { RunnerPresence } from '../runners/runner-presence.service.js';
import { currentPilotId } from '../scope/scope.context.js';
import { ArtifactRelay } from './artifact-relay.js';

const ALICE = 'alice';
const BOB = 'bob';
const PROJECT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d21';
const BOBS_PROJECT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d22';
const RUN = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d31';
const REQUEST = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d11';
const OTHER_REQUEST = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d12';
const B64 = (byte: number, length: number): string => Buffer.alloc(length, byte).toString('base64url');
const HOLDER = B64(1, 32);
const WRAP = { holderId: HOLDER, enc: B64(2, 32), wrappedKey: B64(3, 48), tag: B64(4, 32) };
const SEALED = { nonce: B64(5, 12), ciphertext: B64(6, 40) };

/** A frame of the Runner, without its envelope's `id` and `at`. */
type FromRunner = Extract<RunnerToServer, { type: 'artifact.content' | 'artifact.error' }> extends infer M ? (M extends unknown ? Omit<M, 'id' | 'at'> : never) : never;
type Read = Extract<TabMessage, { type: 'artifact.read' }>;

interface Tab extends TabSocket {
  readonly received: ServerMessage[];
}

let tabCount = 0;
const tabOf = (pilotId: string): Tab => {
  tabCount += 1;
  const received: ServerMessage[] = [];
  return { tabId: `019a6b2c-3d4e-7f00-8a1b-${String(tabCount).padStart(12, '0')}`, pilotId, received, send: (message) => received.push(message) };
};

const read = (overrides: Partial<Read> = {}): Read => ({
  type: 'artifact.read',
  requestId: REQUEST,
  projectId: PROJECT,
  holderId: HOLDER,
  kind: 'ticket',
  ref: { number: 12 },
  ...overrides,
});

const setup = () => {
  const tabs = new Registry<TabMessageHandler>();
  const connections = new RunnerConnections();
  const dispatcher = new RunnerDispatcher();
  let online = true;
  const presence = { isOnline: () => online } as unknown as RunnerPresence;
  const projects: Record<string, { pilotId: string; integrationBranch: string }> = {
    [PROJECT]: { pilotId: ALICE, integrationBranch: 'develop' },
    [BOBS_PROJECT]: { pilotId: BOB, integrationBranch: 'main' },
  };
  // The scoped read of a Projet: only the current Pilote's.
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    const project = projects[where.id];
    return project?.pilotId === currentPilotId() ? { integrationBranch: project.integrationBranch } : null;
  });
  const prisma = { scoped: { project: { findUnique } } } as unknown as PrismaService;
  const runs: Record<string, string> = { [RUN]: ALICE };
  const owners: CommandRunOwners = { owns: (pilotId, runId) => runs[runId] === pilotId };
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
  const relay = new ArtifactRelay(tabs, prisma, new RunnerCommands(connections, presence), dispatcher, owners, logger);
  relay.onModuleInit();

  const sent: ServerToRunner[] = [];
  const link: RunnerLink = { pilotId: ALICE, runnerId: 'runner-1', accepted: true, send: (message) => sent.push(message), close: vi.fn() };
  connections.take(link);
  connections.accepted(link, { type: 'hello' } as Hello);
  const [handler] = tabs.all();
  if (!handler) throw new Error('the relay registered no tab handler');

  return {
    relay,
    runner: { sent },
    logger,
    findUnique,
    goOffline: () => {
      online = false;
    },
    tab: (message: TabMessage, tab: Tab) => handler.handle(tab, message),
    closeTab: (tab: Tab) => handler.closed(tab),
    fromRunner: (message: FromRunner, pilotId = ALICE) =>
      dispatcher.dispatch({ ...message, id: 'm-1', at: '2026-11-20T09:00:00.000Z' } as RunnerToServer, { pilotId, runnerId: 'runner-1', reply: vi.fn() }),
  };
};

/** Lets the relay's read of the Projet resolve (`setImmediate` is never faked here: only `setTimeout`). */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe('ArtifactRelay', () => {
  it('forwards an artifact.read of the Pilote’s Projet to the Runner with the tab’s tabId, and its sealed answer to that tab only, without it', async () => {
    const s = setup();
    const asker = tabOf(ALICE);
    const other = tabOf(ALICE);
    s.tab(read(), asker);

    await vi.waitFor(() =>
      expect(s.runner.sent).toEqual([
        expect.objectContaining({ type: 'artifact.read', requestId: REQUEST, projectId: PROJECT, holderId: HOLDER, kind: 'ticket', ref: { number: 12 }, tabId: asker.tabId }),
      ]),
    );
    await s.fromRunner({ type: 'artifact.content', requestId: REQUEST, tabId: asker.tabId, wrap: WRAP, ...SEALED });

    expect(asker.received).toEqual([{ type: 'artifact.content', requestId: REQUEST, wrap: WRAP, ...SEALED }]);
    expect(other.received).toEqual([]);
  });

  it('forwards the Runner’s artifact.error to the tab, and nothing more for that request', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(read(), tab);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(1));

    await s.fromRunner({ type: 'artifact.error', requestId: REQUEST, tabId: tab.tabId, code: 'artifact.too-large' });
    await s.fromRunner({ type: 'artifact.content', requestId: REQUEST, tabId: tab.tabId, wrap: WRAP, ...SEALED });

    expect(tab.received).toEqual([{ type: 'artifact.error', requestId: REQUEST, code: 'artifact.too-large' }]);
  });

  it('reads a file at the Projet’s integration branch when the tab names no version, and at the one it names otherwise', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(read({ kind: 'file', ref: { path: 'docs/prd.md' } }), tab);
    s.tab(read({ requestId: OTHER_REQUEST, kind: 'file', ref: { path: 'docs/prd.md', at: 'feat/x' } }), tab);

    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(2));
    const refs = s.runner.sent.map((message) => message.type === 'artifact.read' && message.ref);
    expect(refs).toEqual(expect.arrayContaining([{ path: 'docs/prd.md', at: 'develop' }, { path: 'docs/prd.md', at: 'feat/x' }]));
  });

  it('answers artifact.not-found to a read of another Pilote’s Projet, and sends nothing to the Runner', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(read({ projectId: BOBS_PROJECT }), tab);

    await vi.waitFor(() => expect(tab.received).toEqual([{ type: 'artifact.error', requestId: REQUEST, code: 'artifact.not-found' }]));
    expect(s.runner.sent).toEqual([]);
  });

  it('answers artifact.not-found to the output of a run that is not the Pilote’s, and forwards the one of theirs', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(read({ kind: 'command-output', ref: { runId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d39' } }), tab);
    await vi.waitFor(() => expect(tab.received).toEqual([{ type: 'artifact.error', requestId: REQUEST, code: 'artifact.not-found' }]));
    expect(s.runner.sent).toEqual([]);

    s.tab(read({ requestId: OTHER_REQUEST, kind: 'command-output', ref: { runId: RUN } }), tab);
    await vi.waitFor(() => expect(s.runner.sent).toEqual([expect.objectContaining({ kind: 'command-output', ref: { runId: RUN } })]));
  });

  it('answers artifact.runner-offline at once when the Pilote’s Runner is offline, and keeps nothing waiting', async () => {
    const s = setup();
    s.goOffline();
    const tab = tabOf(ALICE);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    s.tab(read(), tab);
    await settle();

    expect(tab.received).toEqual([{ type: 'artifact.error', requestId: REQUEST, code: 'artifact.runner-offline' }]);
    vi.advanceTimersByTime(ARTIFACT_TIMEOUT_SECONDS * 1000);
    expect(tab.received).toHaveLength(1);
  });

  it('answers artifact.timeout when the Runner does not answer within 30 s, then drops its late answer', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    s.tab(read(), tab);
    await settle();
    expect(s.runner.sent).toHaveLength(1);

    vi.advanceTimersByTime(ARTIFACT_TIMEOUT_SECONDS * 1000 - 1);
    expect(tab.received).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(tab.received).toEqual([{ type: 'artifact.error', requestId: REQUEST, code: 'artifact.timeout' }]);

    await s.fromRunner({ type: 'artifact.content', requestId: REQUEST, tabId: tab.tabId, wrap: WRAP, ...SEALED });
    expect(tab.received).toHaveLength(1);
  });

  it('sends nothing to a tab whose socket closed, nor its timeout', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    s.tab(read(), tab);
    await settle();
    expect(s.runner.sent).toHaveLength(1);

    s.closeTab(tab);
    await s.fromRunner({ type: 'artifact.content', requestId: REQUEST, tabId: tab.tabId, wrap: WRAP, ...SEALED });
    vi.advanceTimersByTime(ARTIFACT_TIMEOUT_SECONDS * 1000);
    expect(tab.received).toEqual([]);
  });

  it('asks nothing of the Runner for a tab closed while its Projet was read', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(read(), tab);
    s.closeTab(tab);
    await vi.waitFor(() => expect(s.findUnique).toHaveBeenCalled());
    await settle();

    expect(s.runner.sent).toEqual([]);
  });

  it('drops an answer of another Pilote’s Runner, or for a request no tab made', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(read(), tab);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(1));

    await s.fromRunner({ type: 'artifact.content', requestId: REQUEST, tabId: tab.tabId, wrap: WRAP, ...SEALED }, BOB);
    await s.fromRunner({ type: 'artifact.content', requestId: OTHER_REQUEST, tabId: tab.tabId, wrap: WRAP, ...SEALED });
    expect(tab.received).toEqual([]);

    await s.fromRunner({ type: 'artifact.content', requestId: REQUEST, tabId: tab.tabId, wrap: WRAP, ...SEALED });
    expect(tab.received).toHaveLength(1);
  });

  it('logs the type, the requestId and the kind only: never a ref, a key or a ciphertext', async () => {
    const s = setup();
    const tab = tabOf(ALICE);
    s.tab(read({ kind: 'file', ref: { path: 'secret/plan-MARQUEUR.md' } }), tab);
    await vi.waitFor(() => expect(s.runner.sent).toHaveLength(1));
    await s.fromRunner({ type: 'artifact.content', requestId: REQUEST, tabId: tab.tabId, wrap: WRAP, ...SEALED });

    const logged = JSON.stringify([vi.mocked(s.logger.debug).mock.calls, vi.mocked(s.logger.warn).mock.calls, vi.mocked(s.logger.error).mock.calls]);
    expect(logged).toContain(REQUEST);
    for (const secret of ['MARQUEUR', SEALED.ciphertext, WRAP.wrappedKey, HOLDER]) expect(logged).not.toContain(secret);
  });
});
