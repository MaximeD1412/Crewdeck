import {
  type EngineCapabilities,
  folderCheckAad,
  folderCheckedAad,
  type FolderCheck,
  type FolderCheckResult,
  HEARTBEAT_SECONDS,
  type McpServers,
  projectFolderAad,
  PROTOCOL_VERSION,
  type Runner,
  type RunnerToServer,
  type ServerToRunner,
  type SealedItem,
  type SessionOutcome,
  type TestingRunnerUsage,
  zFolderCheck,
  zServerToRunner,
} from '@crewdeck/contracts';
import WebSocket from 'ws';
import { newId } from '../ids.js';
import type { Fake } from './fakes.js';
import { openItem, sealItem } from './vault.js';

/** How long `connect` waits for `hello.accepted`. */
const ACCEPT_MS = 5_000;

/** What the fake Runner says of its machine in its `hello`. */
export type RunnerMachine = Pick<Runner, 'machine' | 'os' | 'arch' | 'wsl' | 'runnerVersion'>;

const OWN_MACHINE: RunnerMachine = { runnerVersion: 'fake', machine: 'atelier', os: 'linux', arch: 'amd64', wsl: false };

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'id' | 'at'> : never;

/** A folder a scenario seeds on the fake Runner's machine: how it checks, its `name` its path's last part unless given. */
export type SeededFolder = Omit<FolderCheckResult, 'name'> & { readonly name?: string };

/** A folder a Projet may keep: a git repository's root, or a folder without git. */
const ATTACHABLE: ReadonlySet<FolderCheckResult['state']> = new Set(['ready', 'not-git']);

const baseName = (path: string): string => path.replace(/\/+$/, '').split('/').pop() ?? '';

/**
 * The Runner of the scenario's Pilote, for `pnpm dev` and the end-to-end
 * run (`CREWDECK_FAKES=1`): it connects to this server's own `/api/ws` with
 * the scenario's token (`ScenarioSeed.runnerToken`), says `hello`, then
 * heartbeats every `HEARTBEAT_SECONDS`, so that the page sees it « en
 * ligne »; `report` sends its Moteurs' `capabilities` (RUNNER-7),
 * `reportMcpServers` its Serveurs MCP (RUNNER-16), `sendUsage` a Moteur's
 * `usage` (RUNNER-13). Its Sessions (RUNNER-9):
 * `session.start` and `session.resume` answer `active` on the Session's own
 * Moteur id, then `ended` with the outcome `endSessionsWith` set (none: they
 * stay `active`); `session.stop` answers `stopped`; its `hello` tells the
 * Sessions it knows, none alive, as a relaunched Runner. Its folders
 * (PROJET-6): with the vault key a scenario gives it (`useVault`), it answers
 * `folder.check` from the folders seeded (`seedFolder`; any other path is
 * `missing`, a relative one `not-absolute`, another Projet's `taken`), keeps
 * the folder `project.folder.attach` sends when it may, and tells
 * `projects.folders` on connecting and after each change, as the Runner.
 */
export class FakeRunner implements Fake {
  private socket: WebSocket | undefined;
  private heartbeats: NodeJS.Timeout | undefined;
  /** Its last `connect`, which `reconnect` repeats. */
  private last: { readonly baseUrl: string; readonly token: string; readonly machine: RunnerMachine } | undefined;
  /** The Sessions it was asked to run, by id: their Moteur's id. */
  private readonly sessions = new Map<string, string>();
  private sessionsEnd: SessionOutcome | undefined;
  private vaultKey: Uint8Array | undefined;
  /** The folders of its machine, by path. */
  private readonly folders = new Map<string, SeededFolder>();
  /** The Local Projets' folders it keeps, by Projet id: their path. */
  private readonly projects = new Map<string, string>();

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
        this.reportFolders(socket);
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

  /** Sends `usage` in a `usage` message; `false` while not connected. */
  sendUsage(usage: TestingRunnerUsage): boolean {
    if (!this.socket || !this.connected) return false;
    this.send(this.socket, { type: 'usage', ...usage });
    return true;
  }

  /** How its Sessions end once `active`, from now on: `undefined`, they stay `active`; `error`, as a Moteur that failed. */
  endSessionsWith(outcome: SessionOutcome | undefined): void {
    this.sessionsEnd = outcome;
  }

  /** The vault key it opens and seals the folders' texts with, as the Runner's own wrap would give it. */
  useVault(vaultKey: Uint8Array): void {
    this.vaultKey = vaultKey;
  }

  /** A folder at `path` on its machine, checked as `folder`. */
  seedFolder(path: string, folder: SeededFolder): void {
    this.folders.set(path, folder);
  }

  /** The Local Projet `projectId` keeps the folder at `path`, as a Projet created before the scenario starts. */
  keepFolder(projectId: string, path: string): void {
    this.projects.set(projectId, path);
  }

  /** The folder at `path` deleted from its machine: `projects.folders` tells it at once; `false` while not connected. */
  removeFolder(path: string): boolean {
    this.folders.delete(path);
    if (!this.socket || !this.connected) return false;
    this.reportFolders(this.socket);
    return true;
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
    this.vaultKey = undefined;
    this.folders.clear();
    this.projects.clear();
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
      case 'folder.check': {
        const input = this.open(message.sealed, folderCheckAad(message.requestId));
        if (input === undefined || !this.vaultKey) return;
        const sealed = sealItem(this.vaultKey, JSON.stringify(this.check(input.path, input.projectId)), folderCheckedAad(message.requestId));
        this.send(socket, { type: 'folder.checked', requestId: message.requestId, tabId: message.tabId, sealed });
        return;
      }
      case 'project.folder.attach': {
        const path = this.open(message.sealed, projectFolderAad(message.projectId))?.path;
        if (path === undefined) return;
        this.projects.delete(message.projectId);
        if (ATTACHABLE.has(this.check(path).state)) this.projects.set(message.projectId, path);
        this.reportFolders(socket);
        return;
      }
      default:
        return;
    }
  }

  /** What `sealed` holds, its path trimmed as the Runner reads it; `undefined` without the vault key or for what does not open. */
  private open(sealed: SealedItem, aad: string): FolderCheck | undefined {
    if (!this.vaultKey) return undefined;
    try {
      const input = zFolderCheck.parse(JSON.parse(openItem(this.vaultKey, sealed, aad).toString('utf8')));
      return { ...input, path: input.path.trim() };
    } catch {
      return undefined;
    }
  }

  /** `projectId`, a Projet whose folder is chosen again: its own folder is not `taken`. */
  private check(path: string, projectId?: string): FolderCheckResult {
    const name = baseName(path);
    if (!path.startsWith('/') && !path.startsWith('~')) return { state: 'not-absolute', hasCode: false, branch: null, name };
    const folder = this.folders.get(path);
    if (!folder) return { state: 'missing', hasCode: false, branch: null, name };
    const takenBy = [...this.projects].filter(([id, kept]) => kept === path && id !== projectId);
    if (takenBy.length > 0 && ATTACHABLE.has(folder.state)) return { state: 'taken', hasCode: folder.hasCode, branch: folder.branch, name: folder.name ?? name };
    return { ...folder, name: folder.name ?? name };
  }

  /** The Projets whose folder is still on its machine. */
  private reportFolders(socket: WebSocket): void {
    const present = [...this.projects].filter(([, path]) => this.folders.has(path)).map(([projectId]) => projectId);
    this.send(socket, { type: 'projects.folders', present });
  }

  private send(socket: WebSocket, message: WithoutEnvelope<RunnerToServer>): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...message, id: newId(), at: new Date().toISOString() }));
  }
}
