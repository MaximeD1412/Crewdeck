import {
  type EngineCapabilities,
  HEARTBEAT_SECONDS,
  type McpServers,
  PROTOCOL_VERSION,
  type Runner,
  type RunnerToServer,
  type ServerToRunner,
  type SessionOutcome,
  zServerToRunner,
} from '@crewdeck/contracts';
import WebSocket from 'ws';
import { newId } from '../ids.js';
import type { Fake } from './fakes.js';

/** How long `connect` waits for `hello.accepted`. */
const ACCEPT_MS = 5_000;

/** What the fake Runner says of its machine in its `hello`. */
export type RunnerMachine = Pick<Runner, 'machine' | 'os' | 'arch' | 'wsl' | 'runnerVersion'>;

const OWN_MACHINE: RunnerMachine = { runnerVersion: 'fake', machine: 'atelier', os: 'linux', arch: 'amd64', wsl: false };

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'id' | 'at'> : never;

/**
 * The Runner of the scenario's Pilote, for `pnpm dev` and the end-to-end
 * run (`CREWDECK_FAKES=1`): it connects to this server's own `/api/ws` with
 * the scenario's token (`ScenarioSeed.runnerToken`), says `hello`, then
 * heartbeats every `HEARTBEAT_SECONDS`, so that the page sees it « en
 * ligne »; `report` sends its Moteurs' `capabilities` (RUNNER-7),
 * `reportMcpServers` its Serveurs MCP (RUNNER-16). Its Sessions (RUNNER-9):
 * `session.start` and `session.resume` answer `active` on the Session's own
 * Moteur id, then `ended` with the outcome `endSessionsWith` set (none: they
 * stay `active`); `session.stop` answers `stopped`; its `hello` tells the
 * Sessions it knows, none alive, as a relaunched Runner.
 */
export class FakeRunner implements Fake {
  private socket: WebSocket | undefined;
  private heartbeats: NodeJS.Timeout | undefined;
  /** Its last `connect`, which `reconnect` repeats. */
  private last: { readonly baseUrl: string; readonly token: string; readonly machine: RunnerMachine } | undefined;
  /** The Sessions it was asked to run, by id: their Moteur's id. */
  private readonly sessions = new Map<string, string>();
  private sessionsEnd: SessionOutcome | undefined;

  /** Whether its `hello` was accepted and its socket is still open. */
  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Connects to the server at `baseUrl` with `token`, saying `machine`; resolves once its `hello` is accepted. */
  async connect(baseUrl: string, token: string, machine: RunnerMachine = OWN_MACHINE): Promise<void> {
    this.disconnect();
    this.last = { baseUrl, token, machine };
    const url = new URL('/api/ws?client=runner', baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error(`fake runner: no hello.accepted within ${ACCEPT_MS} ms`)), ACCEPT_MS);
      const fail = (error: Error): void => {
        clearTimeout(timer);
        socket.terminate();
        reject(error);
      };
      socket.once('error', fail);
      socket.once('close', (code) => fail(new Error(`fake runner: closed with ${code} before hello.accepted`)));
      socket.once('open', () =>
        this.send(socket, {
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          ...machine,
          sessions: [...this.sessions.keys()].map((sessionId) => ({ sessionId, alive: false })),
        }),
      );
      socket.on('message', (data: WebSocket.RawData) => {
        const parsed = zServerToRunner.safeParse(JSON.parse(data.toString()));
        if (!parsed.success) return;
        if (parsed.data.type !== 'hello.accepted') {
          this.answer(socket, parsed.data);
          return;
        }
        clearTimeout(timer);
        socket.removeAllListeners('close');
        socket.removeAllListeners('error');
        socket.on('error', () => undefined);
        this.heartbeats = setInterval(() => this.send(socket, { type: 'heartbeat' }), HEARTBEAT_SECONDS * 1000);
        this.heartbeats.unref();
        resolve();
      });
    });
  }

  /** Sends `engines` in a `capabilities` message; `false` while not connected. */
  report(engines: readonly EngineCapabilities[]): boolean {
    if (!this.socket || !this.connected) return false;
    this.send(this.socket, { type: 'capabilities', engines: [...engines] });
    return true;
  }

  /** Sends `servers` in a `mcp.servers` message; `false` while not connected. */
  reportMcpServers(servers: McpServers['servers']): boolean {
    if (!this.socket || !this.connected) return false;
    this.send(this.socket, { type: 'mcp.servers', servers: [...servers] });
    return true;
  }

  /** How its Sessions end once `active`, from now on: `undefined`, they stay `active`; `error`, as a Moteur that failed. */
  endSessionsWith(outcome: SessionOutcome | undefined): void {
    this.sessionsEnd = outcome;
  }

  /** Connects again as its last `connect`, the Runner relaunched; `false` when it never connected since its reset. */
  async reconnect(): Promise<boolean> {
    if (!this.last) return false;
    await this.connect(this.last.baseUrl, this.last.token, this.last.machine);
    return true;
  }

  /** Closes its socket, as a Runner that stops: the server sees it offline. */
  disconnect(): void {
    clearInterval(this.heartbeats);
    this.heartbeats = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  reset(): void {
    this.disconnect();
    this.last = undefined;
    this.sessions.clear();
    this.sessionsEnd = undefined;
  }

  private answer(socket: WebSocket, message: ServerToRunner): void {
    switch (message.type) {
      case 'session.start':
      case 'session.resume': {
        const engineSessionId = this.sessions.get(message.sessionId) ?? `fake-${newId()}`;
        this.sessions.set(message.sessionId, engineSessionId);
        this.send(socket, { type: 'session.state', sessionId: message.sessionId, state: 'active', engineSessionId });
        if (this.sessionsEnd === 'ok') this.send(socket, { type: 'session.state', sessionId: message.sessionId, state: 'ended', outcome: 'ok' });
        if (this.sessionsEnd === 'error') this.send(socket, { type: 'session.state', sessionId: message.sessionId, state: 'ended', outcome: 'error', error: 'engine-failed' });
        if (this.sessionsEnd) this.sessions.delete(message.sessionId);
        return;
      }
      case 'session.stop':
        if (this.sessions.has(message.sessionId)) this.send(socket, { type: 'session.state', sessionId: message.sessionId, state: 'stopped' });
        return;
      default:
        return;
    }
  }

  private send(socket: WebSocket, message: WithoutEnvelope<RunnerToServer>): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...message, id: newId(), at: new Date().toISOString() }));
  }
}
