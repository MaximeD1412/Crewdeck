import { type ClientMessage, type ServerMessage, zServerMessage } from '@crewdeck/contracts';
import WebSocket from 'ws';

/** How long `next` and `closed` wait before failing the test. */
const WAIT_MS = 5_000;

export interface ConnectOptions {
  /** The `Cookie` header (`crewdeck_session=…`), for a tab. */
  readonly cookie?: string;
  /** The `Origin` header: the page's, which a tab's socket must come from. */
  readonly origin?: string;
  /** The Runner's token, sent as `Authorization: Bearer …` (RUNNER-2). */
  readonly token?: string;
}

export interface WsClose {
  readonly code: number;
  readonly reason: string;
}

type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

/**
 * A client of `/api/ws` as the page or the Runner would be (ADR 0007): every
 * message the server sends is checked against `zServerMessage`.
 */
export interface WsClient {
  /** Sends a message: a `ClientMessage`, or raw text to send as is. */
  send(message: ClientMessage | string): void;
  /** The next message of `type` after the last one `next` returned (whatever its type). */
  next<T extends ServerMessage['type']>(type: T): Promise<MessageOf<T>>;
  /** Every message received so far, in order. */
  collect(): ServerMessage[];
  /** Resolves when the server closes the socket, with its code. */
  closed(): Promise<WsClose>;
  close(): Promise<void>;
}

const withTimeout = <T>(promise: Promise<T>, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ws-client: no ${what} within ${WAIT_MS} ms`)), WAIT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

/** Opens `/api/ws` of the app at `baseUrl` (`http://127.0.0.1:<port>`); resolves once the socket is open. */
export const connect = async (baseUrl: string, { cookie, origin, token }: ConnectOptions = {}): Promise<WsClient> => {
  const url = new URL('/api/ws', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  if (token) headers['authorization'] = `Bearer ${token}`;
  const socket = new WebSocket(url, { headers, ...(origin ? { origin } : {}) });

  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  let cursor = 0;
  let failure: Error | undefined;

  const closed = new Promise<WsClose>((resolve) => {
    socket.on('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
      for (const wake of waiters.splice(0)) wake();
    });
  });
  socket.on('message', (data: WebSocket.RawData) => {
    const text = Array.isArray(data) ? Buffer.concat(data).toString() : data.toString();
    const parsed = zServerMessage.safeParse(JSON.parse(text));
    if (!parsed.success) failure = new Error(`ws-client: the server sent a message outside zServerMessage: ${text}`);
    else messages.push(parsed.data);
    for (const wake of waiters.splice(0)) wake();
  });

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    }),
    'open',
  );

  const next = async <T extends ServerMessage['type']>(type: T): Promise<MessageOf<T>> => {
    for (;;) {
      if (failure) throw failure;
      const at = messages.findIndex((message, index) => index >= cursor && message.type === type);
      if (at >= 0) {
        cursor = at + 1;
        return messages[at] as MessageOf<T>;
      }
      if (socket.readyState === WebSocket.CLOSED) throw new Error(`ws-client: closed before a ${type}`);
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  return {
    send: (message) => socket.send(typeof message === 'string' ? message : JSON.stringify(message)),
    next: (type) => withTimeout(next(type), type),
    collect: () => {
      if (failure) throw failure;
      return [...messages];
    },
    closed: () => withTimeout(closed, 'close'),
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) return;
      socket.close();
      await closed;
    },
  };
};
