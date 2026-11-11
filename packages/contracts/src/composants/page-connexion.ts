import { z } from 'zod';
import { defineComposant } from './define.js';

/** Why the last sign-in failed: the cases of `GET /api/auth/github/callback` (`/connexion?erreur=<case>`). */
export const SIGN_IN_ERRORS = ['state-mismatch', 'denied', 'github-unavailable'] as const;
export const zSignInError = z.enum(SIGN_IN_ERRORS);
export type SignInError = z.infer<typeof zSignInError>;

/**
 * The sign-in page (US-1, `/connexion`), in the bare Cadre: the welcome, the
 * button « Continuer avec GitHub », which emits `signIn` (the core goes to
 * `/api/auth/github/start`), and, after a failed attempt, a halt Banner above
 * it with the message of its case (`connexion.error.<case>`).
 */
export const PageConnexion = defineComposant({
  name: 'PageConnexion',
  version: 1,
  tag: 'cd-page-connexion',
  category: 'page',
  description: 'La page de connexion, avec GitHub.',
  data: z.object({ error: zSignInError.nullable() }),
  actions: { signIn: z.object({}) },
  slots: [],
  examples: [
    { name: 'nominal', data: { error: null } },
    { name: 'connexion interrompue', data: { error: 'state-mismatch' } },
    { name: 'accès refusé', data: { error: 'denied' } },
    { name: 'GitHub indisponible', data: { error: 'github-unavailable' } },
  ],
});
