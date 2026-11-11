import { z } from 'zod';
import { defineComposant } from './define.js';
import { FORM_CONTROL_NOTE } from './form.js';

/** A native checkbox with its label, a form control (`form.ts`): checked, it submits `on` under `name`. */
export const Checkbox = defineComposant({
  name: 'Checkbox',
  version: 1,
  tag: 'cd-checkbox',
  category: 'signal',
  description: `Une case à cocher. ${FORM_CONTROL_NOTE}`,
  data: z.object({ name: z.string(), label: z.string(), checked: z.boolean() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'cochée', data: { name: 'project-personal-os', label: 'Personal OS', checked: true } },
    { name: 'non cochée', data: { name: 'project-site-mairie', label: 'Site mairie', checked: false } },
  ],
});
