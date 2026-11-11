import type { IncomingMessage } from 'node:http';
import { type Hello, RUNNER_WS_CLOSE, type RunnerToServer, type ServerToRunner } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { RawData, WebSocket } from 'ws';
import { bearerOf, type RunnerCredential, RunnerTokens } from '../auth/runner-tokens.js';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { WS_CLIENTS, type WsClientHandler, type WsClientHandlers } from '../realtime/ws-clients.js';
import { type OutgoingRunnerMessage, type RunnerLink, RunnerConnections, stamp } from './runner-connections.js';
import { parseRunnerMessage, RunnerDispatcher } from './runner-dispatcher.js';
import { RunnerPresence } from './runner-presence.service.js';
import { RunnerProtocol } from './protocol-version.js';

/** The close code of a server fault (RFC 6455). */
const INTERNAL_ERROR = 1011;

const textOf = (data: RawData): string => (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)).toString('utf8');

/**
 * The Runner's socket, `/api/ws?client=runner` (ADR 0004, ADR 0007),
 * authenticated by `Authorization: Bearer <token>`:
 *
 * - an unknown or revoked token gets `hello.rejected` (`unknown-token`,
 *   `revoked`), then the socket is closed with 4401;
 * - its `hello` comes first (anything before gets `error
 *   protocol.hello-required`); a protocol older than the one before the
 *   server's gets `hello.rejected update-required` with the version to
 *   update to, then 4426; else `hello.accepted` at the server's version or
 *   the Runner's, whichever is older, and the Runner online
 *   (`RunnerPresence`). The Pilote's socket before it is closed with 4409;
 * - then each message goes to its handler (`RunnerDispatcher`), in the order
 *   they came; one that is not of `RunnerToServer` gets `error
 *   protocol.invalid`.
 *
 * A message is logged by its type and size only, never its content (it may
 * carry a Session's relay).
 */
@Injectable()
export class RunnersGateway implements WsClientHandler, OnModuleInit {
  readonly client = 'runner';

  constructor(
    @Inject(WS_CLIENTS) private readonly clients: WsClientHandlers,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: RunnerTokens,
    private readonly connections: RunnerConnections,
    private readonly dispatcher: RunnerDispatcher,
    private readonly presence: RunnerPresence,
    private readonly protocol: RunnerProtocol,
    @InjectPinoLogger(RunnersGateway.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.clients.add(this);
    this.dispatcher.registerRunnerHandler('heartbeat', async (_, context) => {
      await this.presence.heartbeat(context.pilotId, context.runnerId);
      context.reply({ type: 'heartbeat.ack' });
    });
  }

  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const token = bearerOf(request);
    const credential = token === undefined ? Promise.resolve(undefined) : this.tokens.find(token);
    new RunnerSocket(socket, this.env.CREWDECK_COMMIT, this.protocol, this.connections, this.dispatcher, this.presence, this.logger).start(credential);
  }
}

/** One Runner's socket, from its upgrade to its close. */
class RunnerSocket implements RunnerLink {
  private credential: RunnerCredential | undefined;
  private isAccepted = false;
  private closed = false;
  /** The messages are handled one after the other, in the order they came. */
  private queue: Promise<void> = Promise.resolve();

  get accepted(): boolean {
    return this.isAccepted;
  }

  constructor(
    private readonly socket: WebSocket,
    private readonly latestVersion: string,
    private readonly protocol: RunnerProtocol,
    private readonly connections: RunnerConnections,
    private readonly dispatcher: RunnerDispatcher,
    private readonly presence: RunnerPresence,
    private readonly logger: PinoLogger,
  ) {}

  get pilotId(): string {
    return this.known().pilotId;
  }

  get runnerId(): string {
    return this.known().runnerId;
  }

  start(credential: Promise<RunnerCredential | undefined>): void {
    this.socket.on('message', (data: RawData) => this.receive(data));
    this.socket.on('close', () => this.cleanUp());
    // The messages wait for the token's lookup in the queue.
    this.enqueue(async () => {
      const found = await credential;
      if (this.closed) return;
      if (!found || found.revoked) {
        this.send(stamp({ type: 'hello.rejected', reason: found ? 'revoked' : 'unknown-token' }));
        return this.close(RUNNER_WS_CLOSE.unauthorized, found ? 'revoked' : 'unknown token');
      }
      this.credential = found;
    });
  }

  send(message: ServerToRunner): void {
    if (this.closed) return;
    const text = JSON.stringify(message);
    this.logger.debug({ direction: 'out', type: message.type, bytes: Buffer.byteLength(text) });
    this.socket.send(text);
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.cleanUp();
    this.socket.close(code, reason);
  }

  private known(): RunnerCredential {
    if (!this.credential) throw new Error('The Runner of this socket is not known yet.');
    return this.credential;
  }

  private receive(data: RawData): void {
    if (this.closed) return;
    const text = textOf(data);
    this.enqueue(() => this.handle(text));
  }

  private enqueue(fn: () => Promise<void>): void {
    this.queue = this.queue.then(fn).catch((error: unknown) => {
      this.logger.error({ err: error }, 'runner socket failed');
      this.close(INTERNAL_ERROR, 'internal error');
    });
  }

  private async handle(text: string): Promise<void> {
    if (this.closed || !this.credential) return;
    const message = parseRunnerMessage(text);
    const bytes = Buffer.byteLength(text);
    if (!message) {
      this.logger.warn({ direction: 'in', type: 'invalid', bytes }, 'invalid runner message');
      return this.reply({ type: 'error', code: 'protocol.invalid' });
    }
    this.logger.debug({ direction: 'in', type: message.type, bytes });
    if (message.type === 'hello') return this.isAccepted ? this.reply({ type: 'error', code: 'protocol.invalid' }) : this.hello(message);
    if (!this.isAccepted) return this.reply({ type: 'error', code: 'protocol.hello-required' });
    await this.dispatch(message);
  }

  private async hello(hello: Hello): Promise<void> {
    if (hello.protocolVersion < this.protocol.oldest) {
      this.reply({ type: 'hello.rejected', reason: 'update-required', latestVersion: this.latestVersion });
      return this.close(RUNNER_WS_CLOSE.updateRequired, 'update required');
    }
    const protocolVersion = Math.min(hello.protocolVersion, this.protocol.version);
    this.connections.take(this)?.close(RUNNER_WS_CLOSE.replaced, 'replaced');
    // hello.accepted before what the onOnline hooks send (RunnerCommands): the Runner reads nothing else until it.
    await this.presence.connected(this.pilotId, this.runnerId, hello, protocolVersion, () => {
      if (this.closed) return false;
      this.isAccepted = true;
      this.reply({ type: 'hello.accepted', runnerId: this.runnerId, protocolVersion });
      return true;
    });
  }

  private async dispatch(message: Exclude<RunnerToServer, Hello>): Promise<void> {
    const handled = await this.dispatcher.dispatch(message, {
      pilotId: this.pilotId,
      runnerId: this.runnerId,
      reply: (answer) => this.reply(answer),
    });
    if (!handled) {
      this.logger.error({ direction: 'in', type: message.type }, 'no handler of this runner message');
      this.reply({ type: 'error', code: 'protocol.invalid' });
    }
  }

  private reply(message: OutgoingRunnerMessage): void {
    this.send(stamp(message));
  }

  private cleanUp(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.credential || !this.connections.release(this)) return;
    const { pilotId, runnerId } = this.credential;
    void this.presence.disconnected(pilotId, runnerId).catch((error: unknown) => {
      this.logger.error({ err: error }, 'runner offline failed');
    });
  }
}
