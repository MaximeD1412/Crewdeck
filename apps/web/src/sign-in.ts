import type { Me } from '@crewdeck/contracts';
import type { RouteMatch } from './router.js';

/** The sign-in page, the only one open without a session. */
export const SIGN_IN_PATH = '/connexion';

/** Where a sign-in leads without a page to come back to, and a Pilote signed in on `/connexion`. */
export const HOME_PATH = '/a-toi';

/**
 * The router's guard for the Pilote `/api/me` gave at boot: signed out, every
 * page but `/connexion` goes to `/connexion?next=<the page, its query and
 * hash>`; signed in, `/connexion` goes to « À toi ».
 */
export const signInGuard =
  (pilot: Me | null) =>
  (match: RouteMatch): string | null => {
    const onSignIn = match.path === SIGN_IN_PATH;
    if (pilot) return onSignIn ? HOME_PATH : null;
    if (onSignIn) return null;
    const next = location.pathname + location.search + location.hash;
    return `${SIGN_IN_PATH}?${new URLSearchParams({ next }).toString()}`;
  };

/** The start of the GitHub sign-in (`GET /api/auth/github/start`), which comes back to `next`. */
export const signInHref = (next: string | undefined, timeZone: string): string =>
  `/api/auth/github/start?${new URLSearchParams({ timeZone, next: next ?? HOME_PATH }).toString()}`;
