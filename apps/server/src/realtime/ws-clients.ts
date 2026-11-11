import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import type { Registry } from './registry.js';

/**
 * Another client of `/api/ws` than a tab, named by the upgrade's
 * `?client=<name>`: the socket is theirs from its opening (RUNNER-2 adds the
 * Runner's, `?client=runner`). A socket naming no registered client is
 * closed with 4400; one naming none is a tab's.
 */
export interface WsClientHandler {
  readonly client: string;
  handleConnection(socket: WebSocket, request: IncomingMessage): void;
}

/** The `Registry<WsClientHandler>` each such client adds itself to. */
export const WS_CLIENTS = Symbol('WS_CLIENTS');
export type WsClientHandlers = Registry<WsClientHandler>;

/** The `client` of an upgrade's query, `undefined` for a tab. */
export const wsClientOf = (request: IncomingMessage): string | undefined =>
  new URL(request.url ?? '/', 'http://localhost').searchParams.get('client') ?? undefined;
