/** The signed-in browser's cookie (`WebSession`): 32 random bytes in base64url. */
export const SESSION_COOKIE = 'crewdeck_session';
/** The cookie of a sign-in in progress (`oauth-state.ts`), sent back only to the callback. */
export const OAUTH_COOKIE = 'crewdeck_oauth';
export const OAUTH_COOKIE_PATH = '/api/auth/github';

export interface CookieOptions {
  /** Seconds; 0 clears it. */
  readonly maxAge: number;
  readonly path: string;
  /** `Secure` on the deployed servers (`isDeployed`): local pages are plain `http://localhost`. */
  readonly secure: boolean;
}

/** The value of cookie `name` in a `Cookie` header, the first one if the browser sent it twice. */
export const readCookie = (header: string | undefined, name: string): string | undefined => {
  for (const part of header?.split(';') ?? []) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
};

/** A `Set-Cookie` line: always HttpOnly and SameSite=Lax (no CSRF token, the Origin check does the rest). */
export const serializeCookie = (name: string, value: string, { maxAge, path, secure }: CookieOptions): string =>
  `${name}=${value}; Max-Age=${maxAge}; Path=${path}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export const clearCookie = (name: string, { path, secure }: Omit<CookieOptions, 'maxAge'>): string =>
  serializeCookie(name, '', { maxAge: 0, path, secure });
