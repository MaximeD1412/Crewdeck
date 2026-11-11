import { z } from 'zod';
import { defineComposant } from './define.js';
import { zTone } from './tone.js';

const zRow = z.object({
  label: z.string(),
  start: z.int().nonnegative(),
  span: z.int().positive(),
  tone: zTone,
  meta: z.string().nullable(),
  detail: z.string().nullable(),
});

/**
 * The milestones of a planning over its weeks (PILOTAGE-2): each row a bar
 * from week `start` (an index of `weeks`) over `span` weeks, `today` the
 * index of the current week. The view computes them.
 */
export const Timeline = defineComposant({
  name: 'Timeline',
  version: 1,
  tag: 'cd-timeline',
  category: 'partie',
  description: 'Les jalons d’un planning sur ses semaines, la semaine en cours marquée.',
  data: z
    .object({ weeks: z.array(z.string()).min(1), today: z.int(), rows: z.array(zRow) })
    .refine(({ weeks, rows }) => rows.every((row) => row.start + row.span <= weeks.length), {
      message: 'une ligne dépasse la dernière semaine',
    }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'trois jalons',
      data: {
        weeks: ['S45', 'S46', 'S47', 'S48', 'S49', 'S50'],
        today: 1,
        rows: [
          { label: 'Agenda', start: 0, span: 1, tone: 'go', meta: null, detail: 'terminé le 6 nov.' },
          { label: 'Planning', start: 1, span: 2, tone: 'accent', meta: '3/5', detail: 'fin estimée 20 nov.' },
          { label: 'Rappels', start: 2, span: 3, tone: 'caution', meta: '0/3', detail: 'bloqué par #51 · fin estimée 4 déc.' },
        ],
      },
    },
  ],
});
