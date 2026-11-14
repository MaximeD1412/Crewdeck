import type { Me } from '@crewdeck/contracts';
import type { RouteMatch } from './router.js';
import { LINK_PATH } from './views/connexion-lien.js';

/** The sign-in page. */
export const SIGN_IN_PATH = '/connexion';

/** The pages open without a session: the sign-in and the page a sign-in link opens. */
const SIGNED_OUT_PATHS: ReadonlySet<string> = new Set([SIGN_IN_PATH, LINK_PATH]);

/** Where a sign-in leads without a page to come back to, and a Pilote signed in on `/connexion`. */
export const HOME_PATH = '/a-toi';

/**
 * The router's guard for the Pilote `/api/me` gave at boot: signed out, every
 * page but `/connexion` and `/connexion/lien` goes to `/connexion?next=<the
 * page, its query and hash>`; signed in, both go to « À toi ».
 */
export const signInGuard =
  (pilot: Me | null) =>
  (match: RouteMatch): string | null => {
    const open = SIGNED_OUT_PATHS.has(match.path);
    if (pilot) return open ? HOME_PATH : null;
    if (open) return null;
    const next = location.pathname + location.search + location.hash;
    return `${SIGN_IN_PATH}?${new URLSearchParams({ next }).toString()}`;
  };

/** The start of the GitHub sign-in (`GET /api/auth/github/start`), which comes back to `next`. */
export const githubSignInHref = (next: string | undefined, timeZone: string): string =>
  `/api/auth/github/start?${new URLSearchParams({ timeZone, next: next ?? HOME_PATH }).toString()}`;
