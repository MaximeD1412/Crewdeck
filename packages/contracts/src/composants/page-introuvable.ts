import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * The page the router renders for a URL no route matches: the copy
 * `router.notFound.title` and a link back to « À toi » (`router.notFound.back`).
 */
export const PageIntrouvable = defineComposant({
  name: 'PageIntrouvable',
  version: 1,
  tag: 'cd-page-introuvable',
  category: 'page',
  description: "La page d'une adresse inconnue, avec un lien vers « À toi ».",
  data: z.object({}),
  actions: {},
  slots: [],
  examples: [{ name: 'nominal', data: {} }],
});
