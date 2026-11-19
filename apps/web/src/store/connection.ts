import {
  WS_CLOSE,
  zServerMessage,
  type ServerMessage,
  type State,
  type TabCommandClientMessage,
  type TabCommandServerMessage,
  type TabRelayClientMessage,
  type TabRelayServerMessage,
  type zClientMessage,
} from '@crewdeck/contracts';
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
  /** This browser's Appareil, named in each socket's URL (`?device=<id>`, E2E-4): the server closes it with 4403 once revoked. */
  readonly device?: () => string | null;
  /** Forgets this browser's Appareil, after a 4403: the next socket names none. */
  readonly forgetDevice?: () => Promise<void>;
  /** The tab's visibility: `document.visibilityState` by default. */
  readonly visibility?: () => DocumentVisibilityState;
}

export interface Connection {
  /** Opens the socket; it reconnects by itself until `stop`. */
  start(): void;
  stop(): void;
  /**
   * After a 409 `realtime.stale`: `resync`, and `hello` with the store's `seq`, the server replaying what the page missed until `live`.
   * One `hello` at a time: asked again meanwhile, the next one goes after that `live`, and only its own `live` ends the `resync`.
   */
  catchUp(): void;
  /**
   * After a change no event tells (the vault key's rotation rewrapped every
   * item key, E2E-4): `resync`, `GET /api/state` read again and applied, then
   * `hello` with its `seq`. A snapshot that cannot be read is owed to the next
   * socket, which reads it before its `hello`.
   */
  refresh(): void;
  /** A message of a Session's relay (SESSION-1) on the open socket; false when none is open. */
  sendRelay(message: TabRelayClientMessage): boolean;
  /** The relay's messages from the server: `session.keys`, `relay`, `session.error`. */
  onRelay(listener: (message: TabRelayServerMessage) => void): () => void;
  /** A message of a Commande's output (RUNNER-18) on the open socket; false when none is open. */
  sendCommand(message: TabCommandClientMessage): boolean;
  /** Its messages from the server: `command.keys`, `command.output`, `command.error`. */
  onCommand(listener: (message: TabCommandServerMessage) => void): () => void;
  /** Each socket opened, after its `hello`: the relays open their Sessions and runs again on it. */
  onOpen(listener: () => void): () => void;
}

/** The waits before each reconnection after a loss, the last one repeated. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000] as const;
/** The server closes a socket silent 60 s. */
export const PING_INTERVAL_MS = 25_000;
/** A ping no message of the server followed within this delay: the socket is lost, even if the browser still holds it open. */
export const PONG_TIMEOUT_MS = 10_000;

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
 * reconnects at once, and so does a ping left unanswered 10 s (a transport
 * the browser still holds open). A socket closed because the session ended
 * (4401) is not opened again. A socket closed because the Appareil it named
 * was revoked (4403, E2E-4) forgets it, then opens one without it at once.
 */
export const createConnection = ({
  store,
  snapshot,
  url = pageSocketUrl(),
  // A WebSocket's handlers take its own events, wider than what the connection reads.
  createSocket = (target) => new WebSocket(target) as unknown as SocketLike,
  visibility = () => document.visibilityState,
  device = () => null,
  forgetDevice = async () => undefined,
}: ConnectionOptions): Connection => {
  let socket: SocketLike | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  /** A `hello` sent on this socket waits for its `live`; the server answers only the last one it got. */
  let awaiting = false;
  /** A catch-up asked while one was waiting: its `hello` goes once the server is `live`. */
  let again = false;
  /** A `refresh` not applied yet: the next socket opened reads the snapshot before its `hello`. */
  let owed = false;

  const relayListeners = new Set<(message: TabRelayServerMessage) => void>();
  const commandListeners = new Set<(message: TabCommandServerMessage) => void>();
  const openListeners = new Set<() => void>();

  const send = (message: Outgoing): boolean => {
    if (socket?.readyState !== OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  const sendVisibility = () => send({ type: 'visibility', visible: visibility() === 'visible' });

  const hello = () => {
    const { seq } = store.getState();
    awaiting = true;
    send({ type: 'hello', lastSeq: seq === null ? null : seq.toString() });
    sendVisibility();
  };

  /** Forgets the current socket and closes it: its later messages and its close are not this connection's any more. */
  const drop = () => {
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    pongTimer = undefined;
    awaiting = again = false;
    if (!socket) return;
    const current = socket;
    socket = null;
    current.onopen = current.onmessage = current.onclose = null;
    current.close();
  };

  const refresh = () => {
    if (stopped) return;
    owed = true;
    store.markStale();
    const current = socket;
    snapshot().then(
      (state) => {
        // A socket opened since reads its own.
        if (stopped || socket !== current) return;
        owed = false;
        store.applySnapshot(state);
        if (current?.readyState !== OPEN) return;
        if (awaiting) again = true;
        else hello();
      },
      () => {
        if (!stopped && current && socket === current) lost('later');
      },
    );
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
    backoff();
  };

  const backoff = () => {
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
        if (again) {
          again = false;
          hello();
          return;
        }
        awaiting = false;
        store.markLive();
        return;
      case 'pong':
        return;
      case 'session.keys':
      case 'relay':
      case 'session.error':
        for (const listener of relayListeners) listener(message);
        return;
      case 'command.keys':
      case 'command.output':
      case 'command.error':
        for (const listener of commandListeners) listener(message);
        return;
    }
  };

  /** A ping, and the deadline of its answer: any message of the server meets it. */
  const ping = () => {
    send({ type: 'ping' });
    pongTimer ??= setTimeout(() => lost('later'), PONG_TIMEOUT_MS);
  };

  const open = () => {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    const named = device();
    const target = new URL(url);
    if (named) target.searchParams.set('device', named);
    const current = createSocket(target.href);
    socket = current;
    current.onopen = () => {
      if (owed) refresh();
      else hello();
      pingTimer = setInterval(ping, PING_INTERVAL_MS);
      for (const listener of openListeners) listener();
    };
    current.onmessage = (event) => {
      clearTimeout(pongTimer);
      pongTimer = undefined;
      const message = parse(event.data);
      if (message) onMessage(message);
    };
    current.onclose = (event) => {
      if (event.code !== WS_CLOSE.deviceRevoked) return lost(event.code === WS_CLOSE.unauthorized ? 'never' : 'later');
      lost('never');
      // Forgotten, the next socket names no Appareil; still named, the backoff keeps it from a loop.
      void forgetDevice()
        .catch(() => undefined)
        .then(() => {
          if (stopped || socket) return;
          if (device() === named) return backoff();
          open();
        });
    };
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
    catchUp() {
      if (socket?.readyState !== OPEN) return;
      store.markStale();
      if (awaiting) again = true;
      else hello();
    },
    refresh,
    sendRelay: (message) => send(message),
    onRelay(listener) {
      relayListeners.add(listener);
      return () => relayListeners.delete(listener);
    },
    sendCommand: (message) => send(message),
    onCommand(listener) {
      commandListeners.add(listener);
      return () => commandListeners.delete(listener);
    },
    onOpen(listener) {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
  };
};
