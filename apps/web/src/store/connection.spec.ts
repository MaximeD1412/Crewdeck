import { WS_CLOSE, type ClientMessage, type Me, type ServerMessage, type State } from '@crewdeck/contracts';
import { createConnection, type Connection, type SocketLike } from './connection.js';
import { createStore, type Store } from './store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris' };
const AT = '2026-11-11T08:00:00.000Z';
const LOST = new Date('2026-11-11T14:12:00.000Z');

/** A socket the test plays the server of: what the page sent, and the server's messages and close. */
class MockSocket implements SocketLike {
  static readonly all: MockSocket[] = [];
  readyState = 0;
  readonly sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    MockSocket.all.push(this);
  }

  static last(): MockSocket {
    const socket = MockSocket.all.at(-1);
    if (!socket) throw new Error('no socket opened');
    return socket;
  }

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ClientMessage);
  }

  close(): void {
    this.drop(1000);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop(code = 1006): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const pilotEvent = (seq: number, login: string): ServerMessage => ({
  type: 'event',
  event: { seq, type: 'pilot.upserted', payload: { ...PILOT, login }, at: AT },
});

let store: Store;
let snapshot: ReturnType<typeof vi.fn<() => Promise<State>>>;
let visibility: DocumentVisibilityState;
const started: Connection[] = [];

const connect = () => {
  const connection = createConnection({
    store,
    snapshot,
    url: 'ws://crewdeck.test/api/ws',
    createSocket: (url) => new MockSocket(url),
    visibility: () => visibility,
  });
  connection.start();
  started.push(connection);
  return connection;
};

/** A connection already live at `seq`, its first socket opened. */
const liveAt = async (seq: number) => {
  snapshot.mockResolvedValueOnce({ seq, pilot: PILOT });
  const connection = connect();
  const socket = MockSocket.last();
  socket.open();
  socket.receive({ type: 'snapshot-required' });
  await vi.waitFor(() => expect(store.getState().seq).toBe(BigInt(seq)));
  socket.receive({ type: 'live' });
  socket.sent.length = 0;
  return { connection, socket };
};

beforeEach(() => {
  MockSocket.all.length = 0;
  store = createStore();
  store.registerSlice('pilot', { shape: 'single' });
  snapshot = vi.fn<() => Promise<State>>();
  visibility = 'visible';
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(LOST);
});

afterEach(() => {
  for (const connection of started.splice(0)) connection.stop();
  vi.useRealTimers();
});

describe('the boot of the connection', () => {
  it('goes connecting → snapshot → live: hello without seq, GET /api/state applied, hello with its seq, then live', async () => {
    snapshot.mockResolvedValueOnce({ seq: 7, pilot: PILOT });
    connect();
    const socket = MockSocket.last();
    expect(socket.url).toBe('ws://crewdeck.test/api/ws');
    expect(store.getState().connection).toBe('connecting');

    socket.open();
    expect(socket.sent).toEqual([
      { type: 'hello', lastSeq: null },
      { type: 'visibility', visible: true },
    ]);

    socket.receive({ type: 'snapshot-required' });
    await vi.waitFor(() => expect(store.getState().slices.pilot).toEqual(PILOT));
    expect(store.getState()).toMatchObject({ seq: 7n, connection: 'connecting' });
    expect(socket.sent.slice(2)).toEqual([
      { type: 'hello', lastSeq: '7' },
      { type: 'visibility', visible: true },
    ]);

    socket.receive({ type: 'live' });
    expect(store.getState()).toMatchObject({ seq: 7n, connection: 'live', lostAt: null });
  });

  it('applies the events the server sends', async () => {
    const { socket } = await liveAt(7);
    socket.receive(pilotEvent(8, 'renamed'));
    expect(store.getState()).toMatchObject({ seq: 8n, slices: { pilot: { login: 'renamed' } } });
  });

  it('ignores a message that is not one of the server’s', async () => {
    const { socket } = await liveAt(7);
    socket.onmessage?.({ data: '{"type":"nope"}' });
    socket.onmessage?.({ data: 'not json' });
    expect(store.getState()).toMatchObject({ seq: 7n, connection: 'live' });
  });
});

describe('a lost socket', () => {
  it('switches to resync with the time of the loss, then reconnects after 1, 2, 5 then 10 s, the hello carrying the seq', async () => {
    const { socket } = await liveAt(7);
    vi.setSystemTime(LOST);
    socket.drop();
    expect(store.getState()).toMatchObject({ connection: 'resync', lostAt: LOST, seq: 7n });

    for (const delay of [1000, 2000, 5000, 10_000, 10_000]) {
      const count = MockSocket.all.length;
      vi.setSystemTime(new Date(Date.now() + 60_000));
      vi.advanceTimersByTime(delay - 1);
      expect(MockSocket.all).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(MockSocket.all).toHaveLength(count + 1);
      MockSocket.last().drop();
    }
    expect(store.getState().lostAt).toEqual(LOST);

    vi.advanceTimersByTime(10_000);
    const next = MockSocket.last();
    next.open();
    expect(next.sent[0]).toEqual({ type: 'hello', lastSeq: '7' });
    next.receive(pilotEvent(8, 'missed'));
    next.receive({ type: 'live' });
    expect(store.getState()).toMatchObject({ connection: 'live', lostAt: null, seq: 8n, slices: { pilot: { login: 'missed' } } });
  });

  it('starts the backoff again at 1 s once live', async () => {
    const { socket } = await liveAt(7);
    socket.drop();
    vi.advanceTimersByTime(1000);
    MockSocket.last().drop();
    vi.advanceTimersByTime(2000);
    const back = MockSocket.last();
    back.open();
    back.receive({ type: 'live' });

    back.drop();
    const count = MockSocket.all.length;
    vi.advanceTimersByTime(1000);
    expect(MockSocket.all).toHaveLength(count + 1);
  });

  it('reconnects at once when the tab becomes visible', async () => {
    const { socket } = await liveAt(7);
    visibility = 'hidden';
    socket.drop();
    const count = MockSocket.all.length;

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(MockSocket.all).toHaveLength(count + 1);
    vi.advanceTimersByTime(1000);
    expect(MockSocket.all).toHaveLength(count + 1);
  });

  it('a snapshot that cannot be read closes the socket, and the page reconnects', async () => {
    snapshot.mockRejectedValueOnce(new Error('offline'));
    connect();
    const socket = MockSocket.last();
    socket.open();
    socket.receive({ type: 'snapshot-required' });
    await vi.waitFor(() => expect(socket.readyState).toBe(3));
    expect(store.getState().connection).toBe('resync');
    vi.advanceTimersByTime(1000);
    expect(MockSocket.all).toHaveLength(2);
  });

  it('does not reconnect once the session ended (4401)', async () => {
    const { socket } = await liveAt(7);
    socket.drop(WS_CLOSE.unauthorized);
    vi.advanceTimersByTime(60_000);
    expect(MockSocket.all).toHaveLength(1);
    expect(store.getState().connection).toBe('resync');
  });
});

describe('a gap in the seq', () => {
  it('on seq n + 2, switches to resync, applies nothing, and reconnects at once with the seq it has', async () => {
    const { socket } = await liveAt(7);
    socket.receive(pilotEvent(9, 'too-far'));

    expect(store.getState()).toMatchObject({ connection: 'resync', seq: 7n, slices: { pilot: { login: 'octocat' } } });
    expect(socket.readyState).toBe(3);
    expect(MockSocket.all).toHaveLength(2);
    const next = MockSocket.last();
    next.open();
    expect(next.sent[0]).toEqual({ type: 'hello', lastSeq: '7' });
  });
});

describe('what the page tells the server', () => {
  it('pings every 25 s while the socket is open', async () => {
    const { socket } = await liveAt(7);
    vi.advanceTimersByTime(25_000);
    expect(socket.sent).toEqual([{ type: 'ping' }]);
    vi.advanceTimersByTime(25_000);
    expect(socket.sent).toEqual([{ type: 'ping' }, { type: 'ping' }]);
    socket.drop();
    vi.advanceTimersByTime(25_000);
    expect(socket.sent).toHaveLength(2);
  });

  it('sends visibility on every visibilitychange', async () => {
    const { socket } = await liveAt(7);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(socket.sent).toEqual([
      { type: 'visibility', visible: false },
      { type: 'visibility', visible: true },
    ]);
  });

  it('catchUp sends hello with the seq, so that the server replays what the page missed', async () => {
    const { connection, socket } = await liveAt(7);
    connection.catchUp();
    expect(socket.sent).toEqual([
      { type: 'hello', lastSeq: '7' },
      { type: 'visibility', visible: true },
    ]);
  });

  it('stop closes the socket, and nothing reconnects nor listens', async () => {
    const { connection, socket } = await liveAt(7);
    connection.stop();
    expect(socket.readyState).toBe(3);
    vi.advanceTimersByTime(60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(MockSocket.all).toHaveLength(1);
  });
});
