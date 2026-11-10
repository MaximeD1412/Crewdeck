import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';

/** A button that is only an icon; `label` is its accessible name. It emits nothing, as Button. */
export const IconButton = defineComposant({
  name: 'IconButton',
  version: 1,
  tag: 'cd-icon-button',
  category: 'signal',
  description: 'Un bouton qui n’est qu’une icône, nommé par son libellé.',
  data: z.object({ icon: zIconName, label: z.string() }),
  actions: {},
  slots: [],
  examples: [{ name: 'fermer', data: { icon: 'x', label: 'Fermer' } }],
});
