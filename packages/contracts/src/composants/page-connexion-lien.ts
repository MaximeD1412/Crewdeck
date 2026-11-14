import { z } from 'zod';
import { defineComposant } from './define.js';

/** `ready` to sign in, `busy` while the token is posted, `invalid` once the server refused it (or the page found none). */
export const zConnexionLienState = z.enum(['ready', 'busy', 'invalid']);
export type ConnexionLienState = z.infer<typeof zConnexionLienState>;

/**
 * The page a sign-in link opens (US-1, `/connexion/lien#<token>`), in the
 * bare Cadre. Opening it uses nothing (a mail scanner follows links): the
 * Pilote clicks « Se connecter » (`confirm`). A link unknown, expired or used
 * shows the halt Banner and « Recevoir un nouveau lien » (`restart`, back to
 * `/connexion`).
 */
export const PageConnexionLien = defineComposant({
  name: 'PageConnexionLien',
  version: 1,
  tag: 'cd-page-connexion-lien',
  category: 'page',
  description: 'La page d’un lien de connexion : « Se connecter » sur cet appareil.',
  data: z.object({ state: zConnexionLienState }),
  actions: { confirm: z.object({}), restart: z.object({}) },
  slots: [],
  examples: [
    { name: 'prête', data: { state: 'ready' } },
    { name: 'connexion en cours', data: { state: 'busy' } },
    { name: 'lien plus valable', data: { state: 'invalid' } },
  ],
});
