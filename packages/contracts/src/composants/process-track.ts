import { z } from 'zod';
import { defineComposant } from './define.js';

/** The state of an Étape on a track: `off` an Étape optionnelle turned off (US-10), `halt` stopped. */
export const zStepState = z.enum(['done', 'current', 'todo', 'off', 'halt']).meta({ title: 'StepState' });
export type StepState = z.infer<typeof zStepState>;

const zStep = z.object({ label: z.string(), meta: z.string().nullable(), state: zStepState });

/**
 * The Étapes of a Conception, of a Ticket or of the getting started
 * (CONCEPTION-2, BOUCLE-5, RUNNER-3): an ordered list, the current one marked
 * as such. `compact` keeps them on one line at every width, without their
 * metas: the steps of « Premiers pas ».
 */
export const ProcessTrack = defineComposant({
  name: 'ProcessTrack',
  version: 1,
  tag: 'cd-process-track',
  category: 'partie',
  description: 'Les Étapes d’une Conception ou d’un Ticket, dans l’ordre, la courante marquée.',
  data: z.object({
    direction: z.enum(['horizontal', 'vertical', 'compact']),
    steps: z.array(zStep).min(1),
  }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'une Conception',
      data: {
        direction: 'horizontal',
        steps: [
          { label: 'Idée retenue', meta: '3 nov.', state: 'done' },
          { label: 'PRD à relire', meta: 'depuis 14:20 · PR #14', state: 'current' },
          { label: 'Maquettes', meta: 'après ton approbation du PRD', state: 'todo' },
          { label: 'Conception technique', meta: null, state: 'todo' },
          { label: 'Découpage en Tickets', meta: null, state: 'todo' },
        ],
      },
    },
    {
      name: 'une Étape désactivée',
      data: {
        direction: 'horizontal',
        steps: [
          { label: 'Idée retenue', meta: '3 nov.', state: 'done' },
          { label: 'PRD', meta: 'approuvé le 5 nov.', state: 'done' },
          { label: 'Maquettes', meta: null, state: 'off' },
          { label: 'Conception technique', meta: 'depuis 9:10', state: 'current' },
          { label: 'Découpage en Tickets', meta: null, state: 'todo' },
        ],
      },
    },
    {
      name: 'arrêtée',
      data: {
        direction: 'horizontal',
        steps: [
          { label: 'Code', meta: 'Claude Code · 24 min', state: 'done' },
          { label: 'Checks', meta: '1 sur 4 échoué', state: 'halt' },
          { label: 'Review', meta: null, state: 'todo' },
          { label: 'Merge', meta: null, state: 'todo' },
        ],
      },
    },
    {
      name: 'verticale, au téléphone',
      data: {
        direction: 'vertical',
        steps: [
          { label: 'Code', meta: 'Claude Code · 24 min', state: 'done' },
          { label: 'Checks', meta: '4 sur 4 passés', state: 'done' },
          { label: 'Review', meta: 'Codex · depuis 6 min', state: 'current' },
          { label: 'Merge', meta: 'par la Boucle, dès que la review passe', state: 'todo' },
        ],
      },
    },
    {
      name: 'compacte, les Premiers pas',
      data: {
        direction: 'compact',
        steps: [
          { label: 'Runner', meta: null, state: 'done' },
          { label: 'Comptes IA', meta: null, state: 'current' },
          { label: 'Projets', meta: null, state: 'todo' },
        ],
      },
    },
  ],
});
