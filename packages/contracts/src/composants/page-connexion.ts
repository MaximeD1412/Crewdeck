import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * Why the last sign-in failed: the cases of `GET /api/auth/github/callback`
 * (`/connexion?erreur=<case>`), and those of a link's request (429
 * `auth.too-many-requests`, 500 `auth.mail-unavailable`) or of a link no
 * longer valid (422 `auth.link-invalid`).
 */
export const SIGN_IN_ERRORS = ['state-mismatch', 'denied', 'github-unavailable', 'too-many-requests', 'mail-unavailable', 'link-invalid'] as const;
export const zSignInError = z.enum(SIGN_IN_ERRORS);
export type SignInError = z.infer<typeof zSignInError>;

/**
 * The sign-in page (US-1, `/connexion`), in the bare Cadre: the welcome, the
 * field « Ton adresse e-mail » and « Recevoir un lien » (`requestLink`,
 * loading while `busy`), then « ou » and « Continuer avec GitHub »
 * (`signInWith`, the core goes to `/api/auth/github/start`). After a failed
 * attempt, a halt Banner above them with the message of its case
 * (`connexion.error.<case>`); `emailError` under the field for an address
 * the server refused. Once a link is sent, `sentTo` in place of the field: a
 * go Banner with the address and « Changer d’adresse » (`changeEmail`).
 */
export const PageConnexion = defineComposant({
  name: 'PageConnexion',
  version: 2,
  tag: 'cd-page-connexion',
  category: 'page',
  description: 'La page de connexion, par un lien envoyé par e-mail ou avec GitHub.',
  data: z.object({
    error: zSignInError.nullable(),
    sentTo: z.string().nullable(),
    emailError: z.string().nullable(),
    busy: z.boolean(),
  }),
  actions: {
    requestLink: z.object({ email: z.string() }),
    signInWith: z.object({ provider: z.literal('github') }),
    changeEmail: z.object({}),
  },
  slots: [],
  examples: [
    { name: 'nominal', data: { error: null, sentTo: null, emailError: null, busy: false } },
    { name: 'envoi en cours', data: { error: null, sentTo: null, emailError: null, busy: true } },
    { name: 'lien envoyé', data: { error: null, sentTo: 'pilote@example.com', emailError: null, busy: false } },
    { name: 'adresse invalide', data: { error: null, sentTo: null, emailError: 'Adresse e-mail invalide.', busy: false } },
    { name: 'trop de liens', data: { error: 'too-many-requests', sentTo: null, emailError: null, busy: false } },
    { name: 'e-mail indisponible', data: { error: 'mail-unavailable', sentTo: null, emailError: null, busy: false } },
    { name: 'connexion interrompue', data: { error: 'state-mismatch', sentTo: null, emailError: null, busy: false } },
    { name: 'accès refusé', data: { error: 'denied', sentTo: null, emailError: null, busy: false } },
    { name: 'GitHub indisponible', data: { error: 'github-unavailable', sentTo: null, emailError: null, busy: false } },
  ],
});
