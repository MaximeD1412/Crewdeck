import { z } from 'zod';
import { defineComposant } from './define.js';

/** Tabs (WAI-ARIA): a click or the arrow keys emit `select` with the tab's id. */
export const Tabs = defineComposant({
  name: 'Tabs',
  version: 1,
  tag: 'cd-tabs',
  category: 'signal',
  description: 'Des onglets, qu’on choisit au clic ou aux flèches.',
  data: z.object({
    tabs: z.array(
      z.object({ id: z.string(), label: z.string(), count: z.number().int().nonnegative().optional(), selected: z.boolean() }),
    ),
  }),
  actions: { select: z.object({ id: z.string() }) },
  slots: [],
  examples: [
    {
      name: 'Idées',
      data: {
        tabs: [
          { id: 'a-trier', label: 'À trier', count: 3, selected: false },
          { id: 'analysees', label: 'Analysées', count: 5, selected: true },
          { id: 'retenues', label: 'Retenues', selected: false },
        ],
      },
    },
  ],
});
