import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * The field to write to an agent: Enter sends, Shift+Enter breaks a line.
 * With `dictation`, its mic asks the core to dictate (`dictate`); the core
 * puts the transcript in `value` for the Pilote to correct before sending.
 */
export const Composer = defineComposant({
  name: 'Composer',
  version: 1,
  tag: 'cd-composer',
  category: 'partie',
  description: 'Le champ pour écrire à un agent, ou lui dicter.',
  data: z.object({
    placeholder: z.string(),
    hint: z.string().nullable(),
    state: z.enum(['idle', 'dictating', 'disabled']),
    value: z.string(),
    dictation: z.boolean(),
  }),
  actions: { send: z.object({ text: z.string().min(1) }), dictate: z.object({}), stopDictation: z.object({}) },
  slots: [],
  examples: [
    { name: 'vide', data: { placeholder: 'Écrire à l’agent, ou dicter', hint: null, state: 'idle', value: '', dictation: true } },
    {
      name: 'dictée en cours',
      data: {
        placeholder: 'Écrire à l’agent, ou dicter',
        hint: null,
        state: 'dictating',
        value: 'Pense aux événements récurrents, et à ce que voit un membre qui quitte l’agenda',
        dictation: true,
      },
    },
    { name: 'sans dictée', data: { placeholder: 'Ou réponds avec tes mots', hint: null, state: 'idle', value: '', dictation: false } },
    {
      name: 'désactivé',
      data: { placeholder: 'Disponible quand ton Runner est en ligne', hint: null, state: 'disabled', value: '', dictation: true },
    },
  ],
});
