import type { IncomingMessage } from 'node:http';
import type { Principal } from '../scope/principal.js';
import type { Registry } from './registry.js';

/**
 * What a socket was opened with and may end before it: a tab's `WebSession`
 * (RUNNER-2 adds the Runner's token). The socket is closed with 4401 when it
 * is revoked (`WsRevocations.revoke`) or once it expires (`check` then says
 * whether its expiry slid meanwhile).
 */
export interface WsCredential {
  readonly kind: 'session';
  readonly id: string;
  readonly expiresAt: Date;
  /** Its expiry now, `undefined` once it has ended. */
  check(): Promise<Date | undefined>;
}

/** Who opens a socket, and the credential that keeps it open. */
export interface WsIdentity {
  readonly principal: Principal;
  readonly credential: WsCredential;
}

/**
 * Who opens a socket of `/api/ws`, from its upgrade request: `null` when it is
 * not theirs to say (no cookie for the cookie's), or when they refuse it.
 * CORE-5 registers the session cookie's (`src/auth/`), RUNNER-2 the Runner's
 * token's; the first identity found wins, none closes the socket with 4401.
 */
export interface WsAuthenticator {
  authenticate(request: IncomingMessage): Promise<WsIdentity | null>;
}

/** The `Registry<WsAuthenticator>` each authenticator adds itself to. */
export const WS_AUTHENTICATORS = Symbol('WS_AUTHENTICATORS');
export type WsAuthenticators = Registry<WsAuthenticator>;
