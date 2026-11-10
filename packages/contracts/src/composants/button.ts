import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';

/**
 * A button. It emits nothing: the Composant that places it emits its own
 * action on its click. Disabled, it says why beside it; loading, it keeps its
 * width and its icon becomes a spinner.
 */
export const Button = defineComposant({
  name: 'Button',
  version: 1,
  tag: 'cd-button',
  category: 'signal',
  description: 'Un bouton, dont le Composant qui le place émet l’action.',
  data: z.object({
    label: z.string(),
    variant: z.enum(['primary', 'secondary', 'ghost', 'danger']),
    size: z.enum(['md', 'sm']),
    icon: zIconName.optional(),
    state: z.enum(['disabled', 'loading']).optional(),
    disabledReason: z.string().optional(),
  }),
  actions: {},
  slots: [],
  examples: [
    { name: 'principal', data: { label: 'Démarrer la Boucle', variant: 'primary', size: 'md', icon: 'play' } },
    { name: 'secondaire', data: { label: 'Ouvrir', variant: 'secondary', size: 'sm' } },
    { name: 'discret', data: { label: 'Annuler', variant: 'ghost', size: 'md' } },
    { name: 'destructif', data: { label: 'Supprimer la Planification', variant: 'danger', size: 'md', icon: 'trash' } },
    {
      name: 'désactivé avec sa raison',
      data: {
        label: 'Merger',
        variant: 'primary',
        size: 'md',
        icon: 'merge',
        state: 'disabled',
        disabledReason: 'Indisponible pendant la Resynchronisation',
      },
    },
    { name: 'en cours', data: { label: 'Enregistrer', variant: 'primary', size: 'md', icon: 'check', state: 'loading' } },
  ],
});
