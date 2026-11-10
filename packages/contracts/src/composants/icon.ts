import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';

/** An icon of the Skin, inline, in the colour of the text around it. */
export const Icon = defineComposant({
  name: 'Icon',
  version: 1,
  tag: 'cd-icon',
  category: 'signal',
  description: 'Une icône du Skin, dans la couleur du texte autour.',
  data: z.object({ name: zIconName, size: z.enum(['md', 'sm']) }),
  actions: {},
  slots: [],
  examples: [
    { name: 'normale', data: { name: 'inbox', size: 'md' } },
    { name: 'petite', data: { name: 'check', size: 'sm' } },
  ],
});
