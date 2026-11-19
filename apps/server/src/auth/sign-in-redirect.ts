import type { SignInError } from '@crewdeck/contracts';

/** What a `@Redirect()` handler of the sign-in returns. */
export interface Redirection {
  readonly url: string;
  readonly statusCode: 302;
}

export const to = (url: string): Redirection => ({ url, statusCode: 302 });

/** Back to `/connexion`, the `PageConnexion` showing why (`error`). */
export const failed = (error: SignInError): Redirection => to(`/connexion?erreur=${error}`);
