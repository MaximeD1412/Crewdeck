import { SIGN_IN_ERRORS, zSignInError, type ComposantData, type PageConnexion, type SignInError } from '@crewdeck/sdk';
import { ApiError } from '../api/request.js';

export type ConnexionView = ComposantData<typeof PageConnexion>;

/** What the form holds since the page opened: `error` `undefined` until a request, the callback's (`?erreur=`) showing. */
interface FormState {
  readonly error: SignInError | null | undefined;
  readonly sentTo: string | null;
  readonly emailError: string | null;
  readonly busy: boolean;
}

const OPENED: FormState = { error: undefined, sentTo: null, emailError: null, busy: false };

/**
 * The sign-in page's data: the form's state, and before any request the
 * error of `?erreur=<case>` of a failed GitHub callback (an unknown case read
 * as none).
 */
export const connexionView = (query: Readonly<Record<string, string>>, form: FormState = OPENED): ConnexionView => ({
  error: form.error === undefined ? (zSignInError.safeParse(query['erreur']).data ?? null) : form.error,
  sentTo: form.sentTo,
  emailError: form.emailError,
  busy: form.busy,
});

/** A refusal of `POST /api/auth/email` the form shows itself: a 400's `fields.email` or an `auth.<case>` of the banner. */
const refusalOf = (error: unknown): Pick<FormState, 'error' | 'emailError'> | null => {
  if (!(error instanceof ApiError)) return null;
  const emailError = error.fields?.['email'];
  if (error.status === 400 && emailError) return { error: null, emailError };
  const known = SIGN_IN_ERRORS.find((code) => error.code === `auth.${code}`);
  return known ? { error: known, emailError: null } : null;
};

export interface ConnexionOptions {
  /** `POST /api/auth/email` (`api/auth.ts`). */
  readonly requestLink: (email: string, next: string) => Promise<void>;
}

export interface Connexion {
  readonly view: (query: Readonly<Record<string, string>>) => ConnexionView;
  /** Asks for a link to `email` coming back to `next`; one at a time. A failure the form cannot show rejects. */
  readonly requestLink: (email: string, next: string) => Promise<void>;
  /** Back to the field, after a link was sent. */
  readonly changeEmail: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * The sign-in form's state (US-1), kept by the page while it is open:
 * `busy` while the link is asked for, then the address it went to, or the
 * server's refusal (under the field, or in the banner).
 */
export const createConnexion = ({ requestLink }: ConnexionOptions): Connexion => {
  let form = OPENED;
  const listeners = new Set<() => void>();
  const set = (next: FormState) => {
    form = next;
    for (const listener of listeners) listener();
  };

  return {
    view: (query) => connexionView(query, form),
    async requestLink(email, next) {
      if (form.busy) return;
      set({ ...form, error: null, emailError: null, busy: true });
      try {
        await requestLink(email, next);
        set({ error: null, sentTo: email.trim().toLowerCase(), emailError: null, busy: false });
      } catch (error) {
        const refusal = refusalOf(error);
        set({ ...form, ...(refusal ?? {}), busy: false });
        if (!refusal) throw error;
      }
    },
    changeEmail: () => set({ ...form, sentTo: null }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
