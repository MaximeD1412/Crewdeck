import { z } from 'zod';
import { defineComposant } from './define.js';

/** Facts as labels and values, a definition list; `mono` for a machine fact (a branch, a version). */
export const KeyValue = defineComposant({
  name: 'KeyValue',
  version: 1,
  tag: 'cd-key-value',
  category: 'partie',
  description: 'Des faits en libellés et valeurs.',
  data: z.object({ items: z.array(z.object({ label: z.string(), value: z.string(), mono: z.boolean() })) }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'un Projet',
      data: {
        items: [
          { label: 'Projet', value: 'Crewdeck', mono: false },
          { label: 'Branche', value: 'feat/30-ui-2-library', mono: true },
          { label: 'Moteur', value: 'Claude Code', mono: false },
        ],
      },
    },
  ],
});
