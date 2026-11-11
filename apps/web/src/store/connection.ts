import { WS_CLOSE, zServerMessage, type ServerMessage, type State, type zClientMessage } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Store } from './store.js';

/** The part of a `WebSocket` the connection uses. */
export interface SocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  send(text: string): void;
  close(): void;
}

export interface ConnectionOptions {
  readonly store: Store;
  /** `GET /api/state`, read on `snapshot-required`. */
  readonly snapshot: () => Promise<State>;
  /** `/api/ws` on the page's origin by default. */
  readonly url?: string;
  readonly createSocket?: (url: string) => SocketLike;
  /** The tab's visibility: `document.visibilityState` by default. */
  readonly visibility?: () => DocumentVisibilityState;
}

export interface Connection {
  /** Opens the socket; it reconnects by itself until `stop`. */
  start(): void;
  stop(): void;
  /** Sends `hello` with the store's `seq`: the server replays what the page missed (after a 409 `realtime.stale`). */
  catchUp(): void;
}

/** The waits before each reconnection after a loss, the last one repeated. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000] as const;
/** The server closes a socket silent 60 s. */
export const PING_INTERVAL_MS = 25_000;

const OPEN = 1;

/** What the page sends: its `seq` as a decimal string (`zSeq`'s input). */
type Outgoing = z.input<typeof zClientMessage>;

const pageSocketUrl = (): string => {
  const url = new URL('/api/ws', location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

const parse = (data: unknown): ServerMessage | null => {
  if (typeof data !== 'string') return null;
  try {
    return zServerMessage.safeParse(JSON.parse(data)).data ?? null;
  } catch {
    return null;
  }
};

/**
 * The page's socket (ADR 0007) feeding its store: `hello` with the last
 * `seq` applied, the snapshot on `snapshot-required`, `live` once the replay
 * is over. A lost socket puts the store in `resync` and reconnects after 1,
 * 2, 5 then 10 s, at once when the tab becomes visible; a skipped `seq`
 * reconnects at once. A socket closed because the session ended (4401) is
 * not opened again.
 */
export const createConnection = ({
  store,
  snapshot,
  url = pageSocketUrl(),
  // A WebSocket's handlers take its own events, wider than what the connection reads.
  createSocket = (target) => new WebSocket(target) as unknown as SocketLike,
  visibility = () => document.visibilityState,
}: ConnectionOptions): Connection => {
  let socket: SocketLike | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let stopped = true;

  const send = (message: Outgoing) => {
    if (socket?.readyState === OPEN) socket.send(JSON.stringify(message));
  };

  const sendVisibility = () => send({ type: 'visibility', visible: visibility() === 'visible' });

  const hello = () => {
    const { seq } = store.getState();
    send({ type: 'hello', lastSeq: seq === null ? null : seq.toString() });
    sendVisibility();
  };

  /** Forgets the current socket and closes it: its later messages and its close are not this connection's any more. */
  const drop = () => {
    clearInterval(pingTimer);
    if (!socket) return;
    const current = socket;
    socket = null;
    current.onopen = current.onmessage = current.onclose = null;
    current.close();
  };

  const scheduleReconnect = (delay: number) => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      open();
    }, delay);
  };

  const lost = (reconnect: 'later' | 'now' | 'never') => {
    drop();
    store.markLost(new Date());
    if (reconnect === 'never') return;
    if (reconnect === 'now') return open();
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] as number;
    attempt += 1;
    scheduleReconnect(delay);
  };

  const onMessage = (message: ServerMessage) => {
    switch (message.type) {
      case 'event':
        if (store.applyEvent(message.event) === 'gap') lost('now');
        return;
      case 'snapshot-required': {
        const current = socket;
        snapshot().then(
          (state) => {
            if (socket !== current) return;
            store.applySnapshot(state);
            hello();
          },
          () => {
            if (socket === current) lost('later');
          },
        );
        return;
      }
      case 'live':
        attempt = 0;
        store.markLive();
        return;
      case 'pong':
        return;
    }
  };

  const open = () => {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    const current = createSocket(url);
    socket = current;
    current.onopen = () => {
      hello();
      pingTimer = setInterval(() => send({ type: 'ping' }), PING_INTERVAL_MS);
    };
    current.onmessage = (event) => {
      const message = parse(event.data);
      if (message) onMessage(message);
    };
    current.onclose = (event) => lost(event.code === WS_CLOSE.unauthorized ? 'never' : 'later');
  };

  const onVisibilityChange = () => {
    sendVisibility();
    if (visibility() === 'visible' && reconnectTimer !== undefined) open();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      document.addEventListener('visibilitychange', onVisibilityChange);
      open();
    },
    stop() {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      drop();
    },
    catchUp: hello,
  };
};
