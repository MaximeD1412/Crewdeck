import { z } from 'zod';
import { defineComposant } from './define.js';
import { FORM_CONTROL_NOTE } from './form.js';

/**
 * A native radio button with its label, a form control (`form.ts`). The
 * Radios of one `name` in the same document or shadow root are one group:
 * one checked, the arrow keys move between them, it submits its `value`.
 */
export const Radio = defineComposant({
  name: 'Radio',
  version: 1,
  tag: 'cd-radio',
  category: 'signal',
  description: `Un bouton radio ; ceux du même nom forment un groupe, qu’on parcourt aux flèches. ${FORM_CONTROL_NOTE}`,
  data: z.object({ name: z.string(), value: z.string(), label: z.string(), checked: z.boolean() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'choisi', data: { name: 'cadence', value: 'nightly', label: 'Chaque nuit', checked: true } },
    { name: 'non choisi', data: { name: 'cadence', value: 'at', label: 'À une heure', checked: false } },
  ],
});
