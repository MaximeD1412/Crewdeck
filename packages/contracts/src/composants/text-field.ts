import { z } from 'zod';
import { defineComposant } from './define.js';
import { FORM_CONTROL_NOTE } from './form.js';

/**
 * A text field, a native `<input>` or, `multiline`, a `<textarea>`. A form
 * control: no action of the core (`form.ts`); it submits `value` under `name`,
 * and with an `error` it reports itself invalid to its form and shows the
 * message under it, which describes it.
 */
export const TextField = defineComposant({
  name: 'TextField',
  version: 1,
  tag: 'cd-text-field',
  category: 'signal',
  description: `Un champ de texte, sur une ou plusieurs lignes. ${FORM_CONTROL_NOTE}`,
  data: z.object({
    name: z.string(),
    label: z.string(),
    value: z.string(),
    placeholder: z.string().nullable(),
    help: z.string().nullable(),
    error: z.string().nullable(),
    state: z.enum(['disabled']).nullable(),
    multiline: z.boolean(),
    maxLength: z.number().int().positive().nullable(),
  }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'défaut',
      data: {
        name: 'title',
        label: 'Ton idée',
        value: '',
        placeholder: 'En une phrase',
        help: 'Tu la détailleras dans sa Conception.',
        error: null,
        state: null,
        multiline: false,
        maxLength: 120,
      },
    },
    {
      name: 'en erreur',
      data: {
        name: 'time',
        label: 'Heure',
        value: '25:00',
        placeholder: null,
        help: 'L’heure de la Planification, chaque jour.',
        error: 'Une heure entre 00:00 et 23:59.',
        state: null,
        multiline: false,
        maxLength: null,
      },
    },
    {
      name: 'plusieurs lignes',
      data: {
        name: 'comment',
        label: 'Ce qu’il faut changer',
        value: '',
        placeholder: 'Ce que l’agent doit reprendre',
        help: null,
        error: null,
        state: null,
        multiline: true,
        maxLength: 2000,
      },
    },
    {
      name: 'désactivé',
      data: {
        name: 'repository',
        label: 'Dépôt GitHub',
        value: 'MaximeD1412/Crewdeck',
        placeholder: null,
        help: 'Choisi à la création du Projet.',
        error: null,
        state: 'disabled',
        multiline: false,
        maxLength: null,
      },
    },
  ],
});
