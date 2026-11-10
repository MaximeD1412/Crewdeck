import { z } from 'zod';
import { defineComposant } from './define.js';

/** A filter one can press, with its count. It emits nothing: the Composant that places it does. */
export const Chip = defineComposant({
  name: 'Chip',
  version: 1,
  tag: 'cd-chip',
  category: 'signal',
  description: 'Un filtre qu’on presse, avec son nombre.',
  data: z.object({ label: z.string(), count: z.number().int().nonnegative().optional(), selected: z.boolean() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'choisi', data: { label: 'Tous les Projets', count: 6, selected: true } },
    { name: 'libre', data: { label: 'Crewdeck', count: 4, selected: false } },
    { name: 'sans nombre', data: { label: 'Personal OS', selected: false } },
  ],
});
