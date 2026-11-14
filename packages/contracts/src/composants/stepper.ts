import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * A number set with « Moins » and « Plus » or the arrow keys (US-93, a
 * Retour's maximum): `change` with the new value, never outside `min..max`.
 */
export const Stepper = defineComposant({
  name: 'Stepper',
  version: 1,
  tag: 'cd-stepper',
  category: 'signal',
  description: 'Un nombre qu’on règle avec « Moins » et « Plus », ou les flèches, entre son minimum et son maximum.',
  data: z
    .object({
      label: z.string(),
      value: z.int(),
      unit: z.string().nullable(),
      min: z.int(),
      max: z.int(),
    })
    .refine(({ value, min, max }) => min <= value && value <= max, { message: 'value doit être entre min et max' }),
  actions: { change: z.object({ value: z.int() }) },
  slots: [],
  examples: [
    { name: 'le maximum d’un Retour', data: { label: 'Au plus', value: 3, unit: 'fois', min: 1, max: 10 } },
    { name: 'à son minimum', data: { label: 'Au minimum', value: 1, unit: 'fois', min: 1, max: 10 } },
  ],
});
