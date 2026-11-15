import { z } from 'zod';
import { defineComposant } from './define.js';
import { zPortType } from './process-canvas-types.js';

/**
 * The states of a port on the canvas: `active` on the Session's path,
 * `unfed` an Entrée nothing feeds (a Manque), `compatible` / `refused` while
 * a Sortie is dragged (a hint on the type only; the core decides).
 */
export const PORT_STATES = ['active', 'unfed', 'compatible', 'refused'] as const;

/**
 * An Entrée (`in`) or a Sortie (`out`) of an Étape: its Type d'artefact as
 * text, then its note; an Entrée's dot on its card's left edge, a Sortie's on
 * its right edge, in the type's colour.
 */
export const Port = defineComposant({
  name: 'Port',
  version: 1,
  tag: 'cd-port',
  category: 'partie',
  description: 'Une Entrée ou une Sortie d’une Étape : son Type d’artefact, sa note, et son point au bord de la carte.',
  data: z.object({
    id: z.string().min(1),
    dir: z.enum(['in', 'out']),
    type: zPortType,
    label: z.string(),
    note: z.string().nullable(),
    state: z.enum(PORT_STATES).nullable(),
  }),
  actions: {},
  slots: [],
  examples: [
    { name: 'une Entrée', data: { id: 'idee', dir: 'in', type: 'idea', label: 'Idée', note: 'notée par toi', state: null } },
    { name: 'une Sortie', data: { id: 'prd', dir: 'out', type: 'prd', label: 'PRD', note: null, state: null } },
    { name: 'une Entrée que rien n’alimente', data: { id: 'inventaire', dir: 'in', type: 'inventory', label: 'Inventaire', note: null, state: 'unfed' } },
    { name: 'une Sortie tirée', data: { id: 'changement', dir: 'out', type: 'code-change', label: 'Changement de code', note: null, state: 'active' } },
    { name: 'une Entrée compatible', data: { id: 'changement', dir: 'in', type: 'code-change', label: 'Changement de code', note: null, state: 'compatible' } },
    { name: 'une Entrée refusée', data: { id: 'maquettes', dir: 'in', type: 'mockups', label: 'Maquettes', note: null, state: 'refused' } },
  ],
});
