import type { IncomingMessage } from 'node:http';
import type { Principal } from '../scope/principal.js';
import type { Registry } from './registry.js';

/**
 * Who opens a socket of `/api/ws`, from its upgrade request: `null` when it is
 * not theirs to say (no cookie for the cookie's), or when they refuse it.
 * CORE-5 registers the session cookie's (`src/auth/`), RUNNER-2 the Runner's
 * token's; the first principal found wins, none closes the socket with 4401.
 */
export interface WsAuthenticator {
  authenticate(request: IncomingMessage): Promise<Principal | null>;
}

/** The `Registry<WsAuthenticator>` each authenticator adds itself to. */
export const WS_AUTHENTICATORS = Symbol('WS_AUTHENTICATORS');
export type WsAuthenticators = Registry<WsAuthenticator>;
