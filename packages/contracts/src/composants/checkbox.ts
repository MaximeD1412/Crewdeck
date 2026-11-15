import { z } from 'zod';
import { defineComposant } from './define.js';
import { FORM_CONTROL_NOTE } from './form.js';

/** A native checkbox with its label and, under it, its `meta`; a form control (`form.ts`): checked, it submits `on` under `name`. */
export const Checkbox = defineComposant({
  name: 'Checkbox',
  version: 2,
  tag: 'cd-checkbox',
  category: 'signal',
  description: `Une case à cocher. ${FORM_CONTROL_NOTE}`,
  data: z.object({ name: z.string(), label: z.string(), meta: z.string().optional(), checked: z.boolean() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'cochée', data: { name: 'project-personal-os', label: 'Personal OS', checked: true } },
    { name: 'non cochée', data: { name: 'project-site-mairie', label: 'Site mairie', checked: false } },
    { name: 'avec sa ligne', data: { name: 'repository-sandbox', label: 'MaximeD1412/sandbox-vue3', meta: 'vide', checked: false } },
  ],
});
