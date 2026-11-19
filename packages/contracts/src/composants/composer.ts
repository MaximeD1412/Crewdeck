import { z } from 'zod';
import { defineComposant } from './define.js';
import { DICTATION_ACTIONS, DICTATION_EXAMPLES, zDictation } from './dictation.js';

const PLACEHOLDER = 'Écrire à l’agent, ou dicter';

/**
 * The field to write to an agent: Enter sends, Shift+Enter breaks a line.
 * Its mic, where the browser can dictate, asks the core to dictate
 * (`dictate-start`) or to stop (`dictate-stop`); the core puts the transcript
 * in `value` for the Pilote to correct before sending, and never sends it.
 */
export const Composer = defineComposant({
  name: 'Composer',
  version: 2,
  tag: 'cd-composer',
  category: 'partie',
  description: 'Le champ pour écrire à un agent, ou lui dicter.',
  data: z.object({
    placeholder: z.string(),
    hint: z.string().nullable(),
    state: z.enum(['idle', 'disabled']),
    value: z.string(),
    dictation: zDictation,
  }),
  actions: { send: z.object({ text: z.string().min(1) }), ...DICTATION_ACTIONS },
  slots: [],
  examples: [
    { name: 'vide', data: { placeholder: PLACEHOLDER, hint: null, state: 'idle', value: '', dictation: DICTATION_EXAMPLES.idle } },
    {
      name: 'dictée en cours',
      data: {
        placeholder: PLACEHOLDER,
        hint: null,
        state: 'idle',
        value: 'Pense aux événements récurrents, et à ce que voit un membre qui quitte l’agenda',
        dictation: DICTATION_EXAMPLES.dictating,
      },
    },
    {
      name: 'première dictée de l’Appareil',
      data: { placeholder: PLACEHOLDER, hint: null, state: 'idle', value: 'Pense aux événements', dictation: DICTATION_EXAMPLES.firstTime },
    },
    { name: 'micro refusé', data: { placeholder: PLACEHOLDER, hint: null, state: 'idle', value: '', dictation: DICTATION_EXAMPLES.refused } },
    { name: 'sans dictée', data: { placeholder: 'Ou réponds avec tes mots', hint: null, state: 'idle', value: '', dictation: DICTATION_EXAMPLES.missing } },
    {
      name: 'désactivé',
      data: { placeholder: 'Disponible quand ton Runner est en ligne', hint: null, state: 'disabled', value: '', dictation: DICTATION_EXAMPLES.idle },
    },
  ],
});
