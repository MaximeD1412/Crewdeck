import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * A Retour's badge, on its curve: « Retour · <max> fois au plus », in
 * caution; `active` on the Session's path.
 */
export const LoopBack = defineComposant({
  name: 'LoopBack',
  version: 1,
  tag: 'cd-loop-back',
  category: 'partie',
  description: 'Le badge d’un Retour, posé sur sa courbe : combien de fois au plus.',
  data: z.object({ max: z.int().min(1).max(10), state: z.enum(['active']).nullable() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'un Retour', data: { max: 3, state: null } },
    { name: 'sur le chemin de la Session', data: { max: 1, state: 'active' } },
  ],
});
