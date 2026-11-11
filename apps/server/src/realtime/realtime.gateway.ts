import type { IncomingMessage } from 'node:http';
import { type ClientMessage, type Event, type ServerMessage, WS_CLOSE, zClientMessage } from '@crewdeck/contracts';
import { Inject } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { RawData, WebSocket } from 'ws';
import type { Principal } from '../scope/principal.js';
import { EventsBus } from './events.bus.js';
import { EventsReplay } from './events.replay.js';
import { RealtimeTiming } from './realtime.timing.js';
import { TabPresence } from './tab-presence.js';
import { WS_AUTHENTICATORS, type WsAuthenticators, type WsCredential, type WsIdentity } from './ws-authenticators.js';
import { WS_CLIENTS, type WsClientHandlers, wsClientOf } from './ws-clients.js';
import { WsRevocations } from './ws-revocations.js';

/** The close code of a server fault (RFC 6455). */
const INTERNAL_ERROR = 1011;

/** The longest delay of `setTimeout`: a later expiry is checked then, and again. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const bytesOf = (data: RawData): number =>
  Array.isArray(data) ? data.reduce((total, part) => total + part.length, 0) : data instanceof ArrayBuffer ? data.byteLength : data.length;

const textOf = (data: RawData): string => (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)).toString('utf8');

/** A message of the client, `undefined` when it is not one of `zClientMessage`. */
const parse = (data: RawData): ClientMessage | undefined => {
  try {
    const parsed = zClientMessage.safeParse(JSON.parse(textOf(data)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** The `type` a log may show of a client's message: one of the protocol's, else `invalid`. */
const loggedType = (message: ClientMessage | undefined): string => message?.type ?? 'invalid';

/**
 * `/api/ws` (ADR 0007): one socket per tab (or Runner), authenticated on the
 * upgrade by `WS_AUTHENTICATORS`, else closed with 4401.
 *
 * - `hello { lastSeq }`: every event after `lastSeq` (`EventsReplay`), then
 *   `live`, then the events as they are committed; `snapshot-required`
 *   instead when `lastSeq` is null or no longer kept. The bus is listened to
 *   before the replay is read: an event committed meanwhile is sent once,
 *   after `live`.
 * - `ping` → `pong`; a socket silent for `RealtimeTiming.silenceMs` is closed (4408).
 * - `visibility`: kept by `TabPresence`.
 * - Anything else closes the socket with 4400. A message is logged by its
 *   type and size only, never its content.
 * - The credential the socket was opened with keeps it open: revoked (a
 *   logout, `WsRevocations`) or expired, the socket is closed with 4401.
 *
 * A socket opened with `?client=<name>` is not a tab's: it goes to the
 * `WS_CLIENTS` handler of that name (the Runner's, `src/runners/`), or is
 * closed with 4400 when there is none.
 */
@WebSocketGateway({ path: '/api/ws' })
export class RealtimeGateway implements OnGatewayConnection {
  constructor(
    @Inject(WS_AUTHENTICATORS) private readonly authenticators: WsAuthenticators,
    @Inject(WS_CLIENTS) private readonly clients: WsClientHandlers,
    private readonly replay: EventsReplay,
    private readonly bus: EventsBus,
    private readonly presence: TabPresence,
    private readonly timing: RealtimeTiming,
    private readonly revocations: WsRevocations,
    @InjectPinoLogger(RealtimeGateway.name) private readonly logger: PinoLogger,
  ) {}

  /** Called as the socket opens: its listeners are set at once, the messages sent before its principal is known wait for it. */
  handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const client = wsClientOf(request);
    if (client !== undefined) {
      const handler = this.clients.all().find((candidate) => candidate.client === client);
      if (handler) return handler.handleConnection(socket, request);
      return socket.close(WS_CLOSE.invalidMessage, 'unknown client');
    }
    new Connection(socket, this.replay, this.bus, this.presence, this.timing, this.revocations, this.logger).start(this.authenticate(request));
  }

  private async authenticate(request: IncomingMessage): Promise<WsIdentity | null> {
    for (const authenticator of this.authenticators.all()) {
      const identity = await authenticator.authenticate(request);
      if (identity) return identity;
    }
    return null;
  }
}

/** One socket of `/api/ws`, from its upgrade to its close. */
class Connection {
  private principal: Principal | undefined;
  private readonly waiting: RawData[] = [];
  private silence: NodeJS.Timeout | undefined;
  private expiry: NodeJS.Timeout | undefined;
  private untrack: (() => void) | undefined;
  private unsubscribe: (() => void) | undefined;
  /** Incremented by each `hello`: a replay overtaken by a later `hello` sends nothing. */
  private hellos = 0;
  private closed = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly replay: EventsReplay,
    private readonly bus: EventsBus,
    private readonly presence: TabPresence,
    private readonly timing: RealtimeTiming,
    private readonly revocations: WsRevocations,
    private readonly logger: PinoLogger,
  ) {}

  start(identity: Promise<WsIdentity | null>): void {
    this.socket.on('message', (data: RawData) => this.receive(data));
    this.socket.on('close', () => this.cleanUp());
    this.armSilence();
    identity.then(
      async (found) => {
        if (this.closed) return;
        if (!found) return this.close(WS_CLOSE.unauthorized, 'unauthorized');
        const { principal, credential } = found;
        this.untrack = this.revocations.track(principal.pilotId, credential, () => this.close(WS_CLOSE.unauthorized, 'revoked'));
        // Checked again before anything is sent: a revocation committed while the
        // socket was authenticated found nothing to close. Messages wait meanwhile.
        if (!(await this.checkCredential(credential))) return;
        this.principal = principal;
        if (principal.kind === 'pilot') this.presence.open(principal.pilotId, this.socket);
        for (const data of this.waiting.splice(0)) this.handle(data);
      },
      (error: unknown) => {
        this.logger.error({ err: error }, 'ws authentication failed');
        this.close(INTERNAL_ERROR, 'internal error');
      },
    );
  }

  private receive(data: RawData): void {
    if (this.closed) return;
    this.armSilence();
    if (this.principal) this.handle(data);
    else this.waiting.push(data);
  }

  private handle(data: RawData): void {
    if (this.closed || !this.principal) return;
    const message = parse(data);
    this.logger.debug({ direction: 'in', type: loggedType(message), bytes: bytesOf(data) });
    if (!message) return this.close(WS_CLOSE.invalidMessage, 'invalid message');
    switch (message.type) {
      case 'ping':
        return this.send({ type: 'pong' });
      case 'visibility':
        if (this.principal.kind === 'pilot') this.presence.setVisibility(this.principal.pilotId, this.socket, message.visible);
        return;
      case 'hello':
        void this.hello(this.principal.pilotId, message.lastSeq).catch((error: unknown) => {
          this.logger.error({ err: error }, 'ws replay failed');
          this.close(INTERNAL_ERROR, 'internal error');
        });
    }
  }

  private async hello(pilotId: string, lastSeq: number | null): Promise<void> {
    const hello = ++this.hellos;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (lastSeq === null) return this.send({ type: 'snapshot-required' });

    // Listened to before the replay is read: what commits meanwhile waits here.
    const queued: Event[] = [];
    let sentUpTo = lastSeq;
    let live = false;
    const unsubscribe = this.bus.subscribe(pilotId, (event) => {
      if (!live) queued.push(event);
      else if (event.seq > sentUpTo) this.sendEvent(event);
    });
    this.unsubscribe = unsubscribe;

    const events = await this.replay.after(pilotId, lastSeq);
    if (this.closed || hello !== this.hellos) return unsubscribe();
    if (!events) {
      unsubscribe();
      this.unsubscribe = undefined;
      return this.send({ type: 'snapshot-required' });
    }
    for (const event of events) this.sendEvent(event);
    sentUpTo = events.at(-1)?.seq ?? lastSeq;
    this.send({ type: 'live' });
    live = true;
    // An event both read by the replay and published meanwhile was sent by the replay.
    for (const event of queued.splice(0)) if (event.seq > sentUpTo) this.sendEvent(event);
  }

  private sendEvent(event: Event): void {
    this.send({ type: 'event', event });
  }

  private send(message: ServerMessage): void {
    if (this.closed) return;
    const text = JSON.stringify(message);
    this.logger.debug({ direction: 'out', type: message.type, bytes: Buffer.byteLength(text) });
    this.socket.send(text);
  }

  /** Closes the socket when its credential has ended, else checks it again when it expires. */
  /** Whether `credential` is still valid; closes the socket when it is not, else re-arms its expiry. */
  private async checkCredential(credential: WsCredential): Promise<boolean> {
    let expiresAt: Date | undefined;
    try {
      expiresAt = await credential.check();
    } catch (error) {
      this.logger.error({ err: error }, 'ws credential check failed');
      this.close(INTERNAL_ERROR, 'internal error');
      return false;
    }
    if (this.closed) return false;
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      this.close(WS_CLOSE.unauthorized, 'expired');
      return false;
    }
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => void this.checkCredential(credential), Math.min(expiresAt.getTime() - Date.now(), MAX_TIMER_MS));
    this.expiry.unref();
    return true;
  }

  private armSilence(): void {
    clearTimeout(this.silence);
    this.silence = setTimeout(() => this.close(WS_CLOSE.silent, 'silent'), this.timing.silenceMs);
    this.silence.unref();
  }

  private close(code: number, reason: string): void {
    if (this.closed) return;
    this.cleanUp();
    this.socket.close(code, reason);
  }

  private cleanUp(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.silence);
    clearTimeout(this.expiry);
    this.untrack?.();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.waiting.length = 0;
    if (this.principal?.kind === 'pilot') this.presence.close(this.principal.pilotId, this.socket);
  }
}
