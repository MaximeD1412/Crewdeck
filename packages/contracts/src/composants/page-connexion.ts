import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * Why the last sign-in failed: the cases of `GET /api/auth/github/callback`
 * and `GET /api/auth/google/callback` (`/connexion?erreur=<case>`; a Google
 * address not verified, `google-unverified`), and those of a link's request
 * (429 `auth.too-many-requests`, 500 `auth.mail-unavailable`) or of a link no
 * longer valid (422 `auth.link-invalid`).
 */
export const SIGN_IN_ERRORS = [
  'state-mismatch',
  'denied',
  'github-unavailable',
  'google-unavailable',
  'google-unverified',
  'too-many-requests',
  'mail-unavailable',
  'link-invalid',
] as const;
export const zSignInError = z.enum(SIGN_IN_ERRORS);
export type SignInError = z.infer<typeof zSignInError>;

/** The accounts « Continuer avec … » signs in with (ADR 0014). */
export const SIGN_IN_PROVIDERS = ['google', 'github'] as const;
export const zSignInProvider = z.enum(SIGN_IN_PROVIDERS);
export type SignInProvider = z.infer<typeof zSignInProvider>;

/**
 * The sign-in page (US-1, `/connexion`), in the bare Cadre: the welcome, the
 * field « Ton adresse e-mail » and « Recevoir un lien » (`requestLink`,
 * loading while `busy`), then « ou », « Continuer avec Google » and «
 * Continuer avec GitHub » (`signInWith`, the core goes to
 * `/api/auth/<provider>/start`). After a failed
 * attempt, a halt Banner above them with the message of its case
 * (`connexion.error.<case>`); `emailError` under the field for an address
 * the server refused. Once a link is sent, `sentTo` in place of the field: a
 * go Banner with the address and « Changer d’adresse » (`changeEmail`).
 */
export const PageConnexion = defineComposant({
  name: 'PageConnexion',
  version: 3,
  tag: 'cd-page-connexion',
  category: 'page',
  description: 'La page de connexion, par un lien envoyé par e-mail, avec Google ou avec GitHub.',
  data: z.object({
    error: zSignInError.nullable(),
    sentTo: z.string().nullable(),
    emailError: z.string().nullable(),
    busy: z.boolean(),
  }),
  actions: {
    requestLink: z.object({ email: z.string() }),
    signInWith: z.object({ provider: zSignInProvider }),
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
    { name: 'Google indisponible', data: { error: 'google-unavailable', sentTo: null, emailError: null, busy: false } },
    { name: 'adresse Google non vérifiée', data: { error: 'google-unverified', sentTo: null, emailError: null, busy: false } },
  ],
});
