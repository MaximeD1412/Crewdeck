import { z } from 'zod';
import { defineComposant } from './define.js';

/** The head of a page: its one `h1`, its count, a link back and its actions, in a `header`. */
export const PageHeader = defineComposant({
  name: 'PageHeader',
  version: 1,
  tag: 'cd-page-header',
  category: 'cadre',
  description: 'L’en-tête d’une page : son titre, son nombre, un retour et ses actions.',
  data: z.object({
    title: z.string(),
    count: z.string().optional(),
    back: z.object({ label: z.string(), href: z.string() }).optional(),
  }),
  actions: {},
  slots: ['actions'],
  examples: [
    {
      name: 'avec action',
      data: { title: 'À toi', count: '6 Décisions' },
      slots: { actions: `<cd-button data='{"label":"Noter une Idée","variant":"primary","size":"md","icon":"plus"}'></cd-button>` },
    },
    { name: 'avec retour', data: { title: 'Bibliothèque de Composants', back: { label: 'Paramètres', href: '/parametres' } } },
  ],
});
