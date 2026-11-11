import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PrincipalRequest } from '../scope/principal.js';
import type { OpenSession } from './web-sessions.js';

/** The request as the auth layer reads and marks it. */
export type AuthRequest = IncomingMessage &
  PrincipalRequest & {
    /** The session the middleware found, which a logout ends. */
    webSession?: OpenSession;
  };

/** The response, for its `Set-Cookie` lines. */
export type AuthResponse = ServerResponse;

/** One request header, the first value if sent twice. */
export const headerOf = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};
