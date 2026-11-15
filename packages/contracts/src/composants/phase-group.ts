import { z } from 'zod';
import { defineComposant } from './define.js';
import { placed } from './placed.js';
import { StepRow } from './step-row.js';

const [agent, loopBack, pilot, gap] = StepRow.examples;
const row = (example: (typeof StepRow.examples)[number] | undefined) => placed(StepRow.tag, example?.data);

/**
 * A Phase on the phone's list of a Process (US-98, PROCESS-11): a native
 * `<details>` whose summary holds its name, its Manques and what it repeats
 * over, its Étapes (`cd-step-row`) in its default Emplacement. `open` is its
 * state when it is rendered; the Pilote then folds and unfolds it freely. The
 * view formats `count` (« 10 Étapes · 2 Retours »); no action.
 */
export const PhaseGroup = defineComposant({
  name: 'PhaseGroup',
  version: 1,
  tag: 'cd-phase-group',
  category: 'partie',
  description: 'Une Phase dans la liste d’un Process : son nom, ses Manques, ce sur quoi elle se répète, puis ses Étapes, qu’on replie.',
  data: z.object({
    name: z.string(),
    forEach: z.string().nullable(),
    count: z.string(),
    gaps: z.int().nonnegative(),
    open: z.boolean(),
  }),
  actions: {},
  slots: ['default'],
  examples: [
    {
      name: 'ouverte, répétée pour chaque Ticket',
      data: { name: 'Développement', forEach: 'chaque Ticket prêt', count: '5 Étapes · 2 Retours', gaps: 1, open: true },
      slots: { default: [row(loopBack), row(gap)].join('') },
    },
    {
      name: 'repliée',
      data: { name: 'Idée', forEach: null, count: '2 Étapes', gaps: 0, open: false },
      slots: { default: [row(agent), row(pilot)].join('') },
    },
  ],
});
