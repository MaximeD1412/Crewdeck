import { z } from 'zod';
import { defineComposant } from './define.js';

/** A statistic (PILOTAGE-3): its value already formatted by the view, its unit, what it measures. */
export const Stat = defineComposant({
  name: 'Stat',
  version: 1,
  tag: 'cd-stat',
  category: 'partie',
  description: 'Un chiffre, formaté par la vue, avec son unité et ce qu’il mesure.',
  data: z.object({
    label: z.string(),
    value: z.string(),
    unit: z.string().nullable(),
    detail: z.string().nullable(),
  }),
  actions: {},
  slots: [],
  examples: [
    { name: 'un délai', data: { label: 'Délai Idée → merge', value: '3,4', unit: 'j', detail: 'médiane · 30 jours' } },
    { name: 'un taux', data: { label: 'Réussite de la Boucle', value: '86', unit: '%', detail: 'mergés sans aide' } },
  ],
});
