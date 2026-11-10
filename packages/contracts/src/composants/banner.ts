import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';
import { zTone } from './tone.js';

/**
 * A message across the page: the Resynchronisation, the Runner offline. A
 * `status`, an `alert` for `halt`; its text in the default Emplacement, its
 * buttons in `actions`.
 */
export const Banner = defineComposant({
  name: 'Banner',
  version: 1,
  tag: 'cd-banner',
  category: 'signal',
  description: 'Un message en travers de la page.',
  data: z.object({ tone: zTone, title: z.string(), icon: zIconName.optional() }),
  actions: {},
  slots: ['default', 'actions'],
  examples: [
    {
      name: 'resynchronisation',
      data: { tone: 'caution', title: 'Resynchronisation…', icon: 'refresh' },
      slots: { default: 'Les Actions sensibles reviennent dès que la page est à jour.' },
    },
    {
      name: 'Runner hors ligne',
      data: { tone: 'halt', title: 'Runner hors ligne', icon: 'wifi' },
      slots: {
        default: 'Les Boucles sont en pause depuis 14:02.',
        actions: `<cd-button data='{"label":"Voir le Runner","variant":"secondary","size":"sm"}'></cd-button>`,
      },
    },
    { name: 'information', data: { tone: 'accent', title: 'Une nouvelle version est prête' } },
  ],
});
