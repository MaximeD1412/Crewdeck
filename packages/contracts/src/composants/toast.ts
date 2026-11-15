import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';

/**
 * A short message over the canvas (a refusal, an activation): a `status`,
 * with no close button; it never removes itself, the core decides how long
 * it stays.
 */
export const Toast = defineComposant({
  name: 'Toast',
  version: 1,
  tag: 'cd-toast',
  category: 'signal',
  description: 'Un court message au-dessus du canevas, que le cœur retire quand il veut.',
  data: z.object({ tone: z.enum(['accent', 'go', 'halt']), icon: zIconName.nullable(), text: z.string() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'refusé', data: { tone: 'halt', icon: 'block', text: 'Cette flèche est refusée : les types ne correspondent pas.' } },
    { name: 'activé', data: { tone: 'go', icon: 'check', text: 'La version 4 du Process est active.' } },
    { name: 'une information', data: { tone: 'accent', icon: null, text: 'Le brouillon est enregistré.' } },
  ],
});
