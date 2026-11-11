import {
  type Hello,
  PROTOCOL_VERSION,
  type RunnerToServer,
  type ServerToRunner,
  type ServerToRunnerType,
  type RunnerMessageOf,
  zServerToRunner,
} from '@crewdeck/contracts';
import WebSocket from 'ws';
import { newId } from '../../src/ids.js';

/** How long `expect` and `closed` wait before failing the test. */
const WAIT_MS = 5_000;

export interface RunnerClose {
  readonly code: number;
  readonly reason: string;
}

type HelloFields = Omit<Hello, 'type' | 'id' | 'at'>;

/** The `hello` of a Runner on Linux under WSL, at the server's protocol. */
export const HELLO: HelloFields = { protocolVersion: PROTOCOL_VERSION, runnerVersion: '0.1.0', machine: 'atelier', os: 'linux', arch: 'amd64', wsl: true };

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'id' | 'at'> : never;

/**
 * A Runner as the server sees it (ADR 0004), on `/api/ws?client=runner`
 * with its Bearer token: every message the server sends is checked against
 * `ServerToRunner`.
 */
export interface FakeRunnerClient {
  /** Sends `hello`, `HELLO` with `overrides`. */
  hello(overrides?: Partial<HelloFields>): void;
  heartbeat(): void;
  /** Sends a message of the protocol (its envelope added), or raw text as is. */
  send(message: WithoutEnvelope<RunnerToServer> | string): void;
  /** The next message of `type` after the last one `expect` returned (whatever its type). */
  expect<T extends ServerToRunnerType>(type: T): Promise<RunnerMessageOf<T>>;
  /** Every message received so far, in order. */
  received(): ServerToRunner[];
  /** Resolves when the server closes the socket, with its code. */
  closed(): Promise<RunnerClose>;
  close(): Promise<void>;
}

const withTimeout = <T>(promise: Promise<T>, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fake runner: no ${what} within ${WAIT_MS} ms`)), WAIT_MS);
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

/** Opens the Runner's socket of the app at `baseUrl` with `token` (none: no `Authorization`); resolves once it is open. */
export const connectRunner = async (baseUrl: string, token?: string): Promise<FakeRunnerClient> => {
  const url = new URL('/api/ws?client=runner', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });

  const messages: ServerToRunner[] = [];
  const waiters: (() => void)[] = [];
  let cursor = 0;
  let failure: Error | undefined;

  const closed = new Promise<RunnerClose>((resolve) => {
    socket.on('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
      for (const wake of waiters.splice(0)) wake();
    });
  });
  socket.on('message', (data: WebSocket.RawData) => {
    const text = Array.isArray(data) ? Buffer.concat(data).toString() : data.toString();
    const parsed = zServerToRunner.safeParse(JSON.parse(text));
    if (!parsed.success) failure = new Error(`fake runner: the server sent a message outside ServerToRunner: ${text}`);
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

  const expect = async <T extends ServerToRunnerType>(type: T): Promise<RunnerMessageOf<T>> => {
    for (;;) {
      if (failure) throw failure;
      const at = messages.findIndex((message, index) => index >= cursor && message.type === type);
      if (at >= 0) {
        cursor = at + 1;
        return messages[at] as RunnerMessageOf<T>;
      }
      if (socket.readyState === WebSocket.CLOSED) throw new Error(`fake runner: closed before a ${type}`);
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  const send = (message: WithoutEnvelope<RunnerToServer> | string): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(typeof message === 'string' ? message : JSON.stringify({ ...message, id: newId(), at: new Date().toISOString() }));
  };

  return {
    hello: (overrides = {}) => send({ type: 'hello', ...HELLO, ...overrides }),
    heartbeat: () => send({ type: 'heartbeat' }),
    send,
    expect: (type) => withTimeout(expect(type), type),
    received: () => {
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
