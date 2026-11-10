import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * A card: a `section-label` title with its count and its actions, then its
 * content. `label` makes it a `section` landmark; `flush` drops the padding of
 * its content, for a list of rows.
 */
export const Card = defineComposant({
  name: 'Card',
  version: 1,
  tag: 'cd-card',
  category: 'partie',
  description: 'Une carte : un titre, son nombre, ses actions, puis son contenu.',
  data: z.object({
    title: z.string().optional(),
    count: z.number().int().nonnegative().optional(),
    label: z.string().optional(),
    flush: z.boolean().optional(),
  }),
  actions: {},
  slots: ['default', 'actions'],
  examples: [
    {
      name: 'avec titre et actions',
      data: { title: 'Boucles en cours', count: 2, label: 'Boucles en cours' },
      slots: {
        default: 'Deux Boucles avancent sur Crewdeck.',
        actions: `<cd-button data='{"label":"Tout voir","variant":"ghost","size":"sm"}'></cd-button>`,
      },
    },
    {
      name: 'liste',
      data: { title: 'Projets', flush: true },
      slots: {
        default: `<cd-list-row data='{"title":"Crewdeck","meta":"4 Tickets ouverts","icon":"folder"}'></cd-list-row><cd-list-row data='{"title":"Personal OS","meta":"2 Tickets ouverts","icon":"folder"}'></cd-list-row>`,
      },
    },
  ],
});
