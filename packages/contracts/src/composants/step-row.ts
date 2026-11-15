import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';

/**
 * An Étape on the phone's list of a Process (US-98, PROCESS-11): its icon
 * (`alert` when it has a Manque), « {name} · {kindLabel} » (the kind left
 * out when it is the name), its Outils, its flow « Entrées → Sorties », its
 * Retour and its Manque. The view composes each line; no action.
 */
export const StepRow = defineComposant({
  name: 'StepRow',
  version: 1,
  tag: 'cd-step-row',
  category: 'partie',
  description: 'Une Étape dans la liste d’un Process : son genre, ses Outils, ses Entrées et Sorties, son Retour et son Manque.',
  data: z.object({
    name: z.string(),
    kindLabel: z.string(),
    icon: zIconName,
    tools: z.string().nullable(),
    flow: z.string(),
    loopBack: z.string().nullable(),
    gap: z.string().nullable(),
  }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'une Étape d’agent',
      data: {
        name: 'PRD',
        kindLabel: 'Agent',
        icon: 'spark',
        tools: 'Rôle Conception · product-design',
        flow: 'Idée → PRD',
        loopBack: null,
        gap: null,
      },
    },
    {
      name: 'avec un Retour',
      data: {
        name: 'Review',
        kindLabel: 'Agent',
        icon: 'spark',
        tools: 'Rôle Review · review',
        flow: 'Changement de code, Verdict (des checks) → Verdict',
        loopBack: 'vers « Code », 3 fois au plus',
        gap: null,
      },
    },
    {
      name: 'une Étape du Pilote',
      data: {
        name: 'Tri de l’Idée',
        kindLabel: 'Pilote',
        icon: 'user',
        tools: null,
        flow: 'Idée → Idée (retenue)',
        loopBack: null,
        gap: null,
      },
    },
    {
      name: 'avec un Manque',
      data: {
        name: 'Tests de bout en bout',
        kindLabel: 'Commande',
        icon: 'terminal',
        tools: null,
        flow: 'Changement de code → Verdict',
        loopBack: null,
        gap: 'Aucune Commande attachée',
      },
    },
  ],
});
