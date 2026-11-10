import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';

/** What a list says when it has nothing to show: an icon, a title, a text and an action. */
export const Empty = defineComposant({
  name: 'Empty',
  version: 1,
  tag: 'cd-empty',
  category: 'signal',
  description: 'Ce qu’une liste dit quand elle n’a rien à montrer.',
  data: z.object({ icon: zIconName, title: z.string() }),
  actions: {},
  slots: ['default', 'actions'],
  examples: [
    {
      name: 'rien ne t’attend',
      data: { icon: 'inbox', title: 'Rien ne t’attend' },
      slots: {
        default: 'Les Décisions des agents arrivent ici.',
        actions: `<cd-button data='{"label":"Noter une Idée","variant":"secondary","size":"md","icon":"plus"}'></cd-button>`,
      },
    },
  ],
});
