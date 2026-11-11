import { z } from 'zod';
import { defineComposant } from './define.js';
import { FORM_CONTROL_NOTE } from './form.js';

/** An on/off switch (`role="switch"`), a form control (`form.ts`): checked, it submits `on` under `name`. */
export const Toggle = defineComposant({
  name: 'Toggle',
  version: 1,
  tag: 'cd-toggle',
  category: 'signal',
  description: `Un interrupteur, activé ou non. ${FORM_CONTROL_NOTE}`,
  data: z.object({
    name: z.string(),
    label: z.string(),
    checked: z.boolean(),
    help: z.string().nullable(),
    state: z.enum(['disabled']).nullable(),
  }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'activé',
      data: {
        name: 'notifications',
        label: 'Notifications sur le téléphone',
        checked: true,
        help: 'Quand une Décision t’attend et que tu n’es pas là.',
        state: null,
      },
    },
    { name: 'inactif', data: { name: 'visualReview', label: 'Revue visuelle', checked: false, help: null, state: null } },
    {
      name: 'désactivé',
      data: {
        name: 'crossReview',
        label: 'Revue croisée',
        checked: false,
        help: 'Il faut un second Compte IA.',
        state: 'disabled',
      },
    },
  ],
});
