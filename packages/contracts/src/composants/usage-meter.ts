import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * The usage of a Compte IA against one of its limits (RUNNER-13): `value`
 * in percent, `detail` when it resets, `projection` what the current pace
 * leads to, the figures formatted by the view. Without `tone`, the bar is
 * `halt` at 100, `caution` from 80, `accent` below.
 */
export const UsageMeter = defineComposant({
  name: 'UsageMeter',
  version: 1,
  tag: 'cd-usage-meter',
  category: 'partie',
  description: 'L’usage d’un Compte IA face à une de ses limites, en pourcentage.',
  data: z.object({
    label: z.string(),
    value: z.number().min(0).max(100),
    detail: z.string().nullable(),
    projection: z.string().nullable(),
    tone: z.enum(['accent', 'caution', 'halt']).nullable(),
  }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'limite atteinte',
      data: { label: 'Fenêtre de 5 h', value: 100, detail: '16:40', projection: null, tone: null },
    },
    {
      name: 'avec une projection',
      data: {
        label: 'Semaine',
        value: 62,
        detail: 'lundi',
        projection: 'Au rythme actuel, la semaine tient jusqu’à jeudi.',
        tone: null,
      },
    },
    { name: 'large', data: { label: 'Fenêtre de 5 h', value: 30, detail: '21:10', projection: null, tone: null } },
  ],
});
