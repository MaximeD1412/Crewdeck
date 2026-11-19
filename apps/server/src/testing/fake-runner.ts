import { randomBytes } from 'node:crypto';
import {
  type CommandRunReason,
  type EngineCapabilities,
  type EngineEvent,
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
  SESSION_KEY_INFO,
  type SessionInput,
  type SessionInputPayload,
  type SessionOutcome,
  type SessionReplay,
  type TestingRunnerUsage,
  zFolderCheck,
  zServerToRunner,
  zSessionInputPayload,
} from '@crewdeck/contracts';
import WebSocket from 'ws';
import { newId } from '../ids.js';
import type { Fake } from './fakes.js';
import { openFrame, openItem, sealFrame, sealItem, sealWrap } from './vault.js';

/** How long `connect` waits for `hello.accepted`. */
const ACCEPT_MS = 5_000;

/** What the fake Runner says of its machine in its `hello`. */
export type RunnerMachine = Pick<Runner, 'machine' | 'os' | 'arch' | 'wsl' | 'runnerVersion'>;

const OWN_MACHINE: RunnerMachine = { runnerVersion: 'fake', machine: 'atelier', os: 'linux', arch: 'amd64', wsl: false };

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'id' | 'at'> : never;
type WithoutStamp<T> = T extends unknown ? Omit<T, 'seq' | 'at'> : never;

/** A folder a scenario seeds on the fake Runner's machine: how it checks, its `name` its path's last part unless given. */
export type SeededFolder = Omit<FolderCheckResult, 'name'> & { readonly name?: string };

/** A folder a Projet may keep: a git repository's root, or a folder without git. */
const ATTACHABLE: ReadonlySet<FolderCheckResult['state']> = new Set(['ready', 'not-git']);

const baseName = (path: string): string => path.replace(/\/+$/, '').split('/').pop() ?? '';

type Request = Extract<EngineEvent, { kind: 'question' | 'permission-request' }>;
type AnswerFields = Pick<Extract<EngineEvent, { kind: 'answer' }>, 'options' | 'text' | 'decision'>;

/** The questions and permission requests of `log` no `answer` followed. */
const pendingRequests = (log: readonly EngineEvent[]): Request[] => {
  const answered = new Set(log.flatMap((event) => (event.kind === 'answer' ? [event.requestId] : [])));
  return log.filter((event): event is Request => (event.kind === 'question' || event.kind === 'permission-request') && !answered.has(event.requestId));
};

/** The `answer` event's fields for `input` to `request`; `null` when it does not answer it (another kind, an option outside it). */
const answerOf = (request: Request, input: Exclude<SessionInputPayload, { kind: 'message' }>): AnswerFields | null => {
  if (input.kind === 'permission') return request.kind === 'permission-request' ? { decision: input.decision } : null;
  if (request.kind !== 'question') return null;
  if (input.text !== undefined) return { text: input.text };
  const labels = (input.optionIndexes ?? []).map((index) => request.options[index]?.label);
  return labels.length > 0 && labels.every((label) => label !== undefined) ? { options: labels as string[] } : null;
};

/** A Session whose log the fake Runner holds (`holdSession`), as a Runner that ran it. */
export interface HeldSession {
  /** The fake Runner's own X25519 private key (raw bytes), which authenticates the wraps of the Session's key. */
  readonly runnerPrivateKey: Uint8Array;
  /** The X25519 public keys (raw bytes) of the Appareils it wraps the Session's key for. */
  readonly holders: readonly Uint8Array[];
  /** Its log, `seq` 1, 2, … */
  readonly events: readonly EngineEvent[];
}

/** What the fake Runner's agent answers to the Pilote's `text`. */
export const heldReply = (text: string): string => `Noté : « ${text} ».`;
/** How the fake Runner's runs of a Commande end: an exit code, or a reason without one. */
export type FakeCommandEnd = { readonly reason: 'exited'; readonly exitCode: number } | { readonly reason: Exclude<CommandRunReason, 'exited'> };

/** The two chunks of a fake run: opaque bytes, as the server sees a real one's. */
const fakeChunk = (seq: number) => ({ seq, nonce: Buffer.alloc(12, seq).toString('base64url'), ciphertext: Buffer.alloc(32, 0xf0 + seq).toString('base64url') });

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
 * Sessions it knows, none alive, as a relaunched Runner. The relay of a
 * Session it holds (`holdSession`, SESSION-2): `session.replay` answers its
 * key wrapped for its holders and its log from `fromSeq`, sealed, to the tab
 * that asked; `session.input` adds the agent's `heldReply`, live to every tab;
 * the answer to a question or a permission still pending in its log
 * (SESSION-3) adds its `answer` event and says `session.answered` (the
 * agent's `heldReply` to a question's), one already answered is ignored; its
 * `session.start` and `session.resume` say `session.waiting` for each request
 * still pending. Its folders (PROJET-6): with the vault key a scenario gives
 * it (`useVault`), it answers `folder.check` from the folders seeded
 * (`seedFolder`; any other path is `missing`, a relative one `not-absolute`,
 * another Projet's `taken`), keeps the folder `project.folder.attach` sends
 * when it may, and tells `projects.folders` on connecting and after each
 * change, as the Runner.
 * Its Commandes (RUNNER-18): `command.run` answers `command.started`, two
 * output chunks (opaque bytes) and the verdict `endCommandsWith` set (by
 * default exited with 0); `command.replay` sends the tab those two chunks again.
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
  /** The Sessions whose log it holds, by id: their key and log. */
  private readonly held = new Map<string, HeldSession & { readonly key: Buffer; readonly log: EngineEvent[] }>();
  private commandsEnd: FakeCommandEnd = { reason: 'exited', exitCode: 0 };

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

  /** Holds the log of `sessionId` under a key of its own, for the tabs that open it from now on. */
  holdSession(sessionId: string, session: HeldSession): void {
    this.held.set(sessionId, { ...session, key: randomBytes(32), log: [...session.events] });
  }

  /** How its runs of a Commande end, from now on. */
  endCommandsWith(end: FakeCommandEnd): void {
    this.commandsEnd = end;
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
    this.held.clear();
    this.commandsEnd = { reason: 'exited', exitCode: 0 };
  }

  private answer(socket: WebSocket, message: ServerToRunner): void {
    switch (message.type) {
      case 'session.start':
      case 'session.resume': {
        const engineSessionId = this.sessions.get(message.sessionId) ?? `fake-${newId()}`;
        this.sessions.set(message.sessionId, engineSessionId);
        this.send(socket, { type: 'session.state', sessionId: message.sessionId, state: 'active', engineSessionId });
        this.sayWaiting(socket, message.sessionId);
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
      case 'session.replay':
        return this.replay(socket, message);
      case 'session.input':
        return this.reply(socket, message);
      case 'command.run': {
        const { runId } = message;
        this.send(socket, { type: 'command.started', runId });
        for (const seq of [1, 2]) this.send(socket, { type: 'command.output', runId, ...fakeChunk(seq) });
        const end = this.commandsEnd;
        const exitCode = end.reason === 'exited' ? end.exitCode : null;
        this.send(socket, { type: 'command.verdict', runId, passed: exitCode === 0 || end.reason === 'healthy', exitCode, reason: end.reason, durationMs: 1200 });
        return;
      }
      case 'command.replay':
        for (const seq of [1, 2]) if (seq >= message.fromSeq) this.send(socket, { type: 'command.output', runId: message.runId, tabId: message.tabId, ...fakeChunk(seq) });
        return;
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

  private replay(socket: WebSocket, { sessionId, tabId, fromSeq }: SessionReplay): void {
    const held = this.held.get(sessionId);
    if (!held) return;
    const wraps = held.holders.map((holder) => {
      const holderId = Buffer.from(holder).toString('base64url');
      const wrap = sealWrap(held.runnerPrivateKey, holder, held.key, SESSION_KEY_INFO, `${sessionId}:${holderId}`);
      return { holderId, enc: wrap.enc.toString('base64url'), wrappedKey: wrap.ciphertext.toString('base64url'), tag: wrap.tag.toString('base64url') };
    });
    this.send(socket, { type: 'session.keys', sessionId, tabId, wraps });
    for (const event of held.log.filter(({ seq }) => seq >= fromSeq)) {
      this.send(socket, { type: 'relay', sessionId, tabId, seq: event.seq, ...sealFrame(held.key, JSON.stringify(event), `${sessionId}:${event.seq}`) });
    }
  }

  private reply(socket: WebSocket, { sessionId, inputId, nonce, ciphertext }: SessionInput): void {
    const held = this.held.get(sessionId);
    if (!held) return;
    let input: SessionInputPayload;
    try {
      input = zSessionInputPayload.parse(JSON.parse(openFrame(held.key, { nonce, ciphertext }, `${sessionId}:input:${inputId}`).toString('utf8')));
    } catch {
      return;
    }
    if (input.kind === 'message') return this.append(socket, sessionId, { kind: 'message', from: 'agent', text: heldReply(input.text), final: true });
    const request = pendingRequests(held.log).find(({ requestId }) => requestId === input.requestId);
    const answer = request && answerOf(request, input);
    // Already answered (from another tab), or outside the request: ignored, as the Runner does.
    if (!answer) return;
    this.append(socket, sessionId, { kind: 'answer', requestId: input.requestId, ...answer });
    this.send(socket, { type: 'session.answered', sessionId, requestId: input.requestId });
    if (answer.decision === undefined) this.append(socket, sessionId, { kind: 'message', from: 'agent', text: heldReply(answer.text ?? answer.options?.join(', ') ?? ''), final: true });
  }

  /** Adds `event` to the log of the held Session and relays it live, to every tab. */
  private append(socket: WebSocket, sessionId: string, event: WithoutStamp<EngineEvent>): void {
    const held = this.held.get(sessionId);
    if (!held) return;
    const stamped = { ...event, seq: held.log.length + 1, at: new Date().toISOString() } as EngineEvent;
    held.log.push(stamped);
    this.send(socket, { type: 'relay', sessionId, seq: stamped.seq, ...sealFrame(held.key, JSON.stringify(stamped), `${sessionId}:${stamped.seq}`) });
  }

  /** The requests of the held Session still pending: `session.waiting` for each, as the Runner says them once its Moteur runs. */
  private sayWaiting(socket: WebSocket, sessionId: string): void {
    const held = this.held.get(sessionId);
    if (!held) return;
    for (const request of pendingRequests(held.log)) {
      this.send(socket, { type: 'session.waiting', sessionId, requestId: request.requestId, kind: request.kind === 'question' ? 'question' : 'permission', seq: request.seq });
    }
  }

  private send(socket: WebSocket, message: WithoutEnvelope<RunnerToServer>): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...message, id: newId(), at: new Date().toISOString() }));
  }
}
