import type { ClientMessage, ServerMessage } from '@crewdeck/contracts';
import type { Registry } from './registry.js';

/** A tab's message the gateway does not answer itself: another module's (the relay of a Session, SESSION-1). */
export type TabMessage = Exclude<ClientMessage, { type: 'hello' | 'ping' | 'visibility' }>;

/** A Pilote's tab, one socket of `/api/ws`, as the module answering its messages sees it. */
export interface TabSocket {
  /** Drawn by the server for the socket, never told to the tab: the Runner's answers to this tab name it. */
  readonly tabId: string;
  readonly pilotId: string;
  /** Sends a message to the tab, nothing once its socket is closed. */
  send(message: ServerMessage): void;
}

/**
 * Who answers some of a tab's messages: `handle` runs in the scope of the
 * tab's Pilote and handles its own failures; `closed` is called once its
 * socket closes. A message no handler takes closes the socket with 4400.
 */
export interface TabMessageHandler {
  readonly types: readonly TabMessage['type'][];
  handle(tab: TabSocket, message: TabMessage): void;
  closed(tab: TabSocket): void;
}

/** The `Registry<TabMessageHandler>` each such module adds itself to. */
export const WS_TABS = Symbol('WS_TABS');
export type WsTabHandlers = Registry<TabMessageHandler>;
