import { zEmailLinkToken, type EmailLinkVerified } from '@crewdeck/contracts';
import type { ComposantData, ConnexionLienState, PageConnexionLien } from '@crewdeck/sdk';
import { ApiError } from '../api/request.js';

export type ConnexionLienView = ComposantData<typeof PageConnexionLien>;

/** The page a sign-in link opens, its token in the fragment (`/connexion/lien#<token>`). */
export const LINK_PATH = '/connexion/lien';

/**
 * The sign-in link's token, taken out of the address bar before anything
 * else (ADR 0014): on `/connexion/lien`, the fragment is removed with
 * `history.replaceState` and its token, when it is one, kept in memory
 * only. Any other page keeps its fragment.
 */
export const takeLinkToken = (): string | null => {
  if (location.pathname !== LINK_PATH || !location.hash) return null;
  const fragment = location.hash.slice(1);
  history.replaceState(history.state, '', location.pathname + location.search);
  return zEmailLinkToken.safeParse(fragment).success ? fragment : null;
};

export interface ConnexionLienOptions {
  /** The token `takeLinkToken` took at boot, `null` without one. */
  readonly token: string | null;
  readonly timeZone: string;
  /** `POST /api/auth/email/verify` (`api/auth.ts`). */
  readonly verifyLink: (token: string, timeZone: string) => Promise<EmailLinkVerified>;
  /** A full load of the page signed in, as after the GitHub sign-in. */
  readonly leave: (url: string) => void;
  readonly navigate: (url: string) => void;
}

export interface ConnexionLien {
  readonly view: () => ConnexionLienView;
  /** « Se connecter »: posts the token once; a failure other than the link's refusal rejects. */
  readonly confirm: () => Promise<void>;
  /** « Recevoir un nouveau lien »: back to `/connexion`. */
  readonly restart: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * The sign-in link's page (US-1): opening it posts nothing (a mail scanner
 * follows links), « Se connecter » does. A link unknown, expired or used
 * (422 `auth.link-invalid`) is spent: the page offers a new one.
 */
export const createConnexionLien = ({ token, timeZone, verifyLink, leave, navigate }: ConnexionLienOptions): ConnexionLien => {
  let held = token;
  let state: ConnexionLienState = held ? 'ready' : 'invalid';
  const listeners = new Set<() => void>();
  const set = (next: ConnexionLienState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    view: () => ({ state }),
    async confirm() {
      if (state !== 'ready' || !held) return;
      set('busy');
      try {
        const { next } = await verifyLink(held, timeZone);
        held = null;
        leave(next);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'auth.link-invalid') {
          held = null;
          set('invalid');
          return;
        }
        set('ready');
        throw error;
      }
    },
    restart: () => navigate('/connexion'),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
