import { HEARTBEAT_SECONDS, PROTOCOL_VERSION, type Runner, type RunnerToServer, zServerToRunner } from '@crewdeck/contracts';
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
 * ligne ». Later tickets add its behaviours (capabilities, Sessions).
 */
export class FakeRunner implements Fake {
  private socket: WebSocket | undefined;
  private heartbeats: NodeJS.Timeout | undefined;

  /** Whether its `hello` was accepted and its socket is still open. */
  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Connects to the server at `baseUrl` with `token`, saying `machine`; resolves once its `hello` is accepted. */
  async connect(baseUrl: string, token: string, machine: RunnerMachine = OWN_MACHINE): Promise<void> {
    this.disconnect();
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
        this.send(socket, { type: 'hello', protocolVersion: PROTOCOL_VERSION, ...machine }),
      );
      socket.on('message', (data: WebSocket.RawData) => {
        const parsed = zServerToRunner.safeParse(JSON.parse(data.toString()));
        if (!parsed.success || parsed.data.type !== 'hello.accepted') return;
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

  disconnect(): void {
    clearInterval(this.heartbeats);
    this.heartbeats = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  reset(): void {
    this.disconnect();
  }

  private send(socket: WebSocket, message: WithoutEnvelope<RunnerToServer>): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...message, id: newId(), at: new Date().toISOString() }));
  }
}
