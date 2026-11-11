import { z } from 'zod';
import { defineComposant } from './define.js';

/** A check of a PR (BOUCLE-5): its name, its state, how long or how many; `href` its log. */
export const CheckRow = defineComposant({
  name: 'CheckRow',
  version: 1,
  tag: 'cd-check-row',
  category: 'partie',
  description: 'Un check d’une PR : son nom, son état, son détail.',
  data: z.object({
    name: z.string(),
    state: z.enum(['passed', 'failed', 'running']),
    detail: z.string().nullable(),
    href: z.string().nullable(),
  }),
  actions: {},
  slots: [],
  examples: [
    { name: 'réussi', data: { name: 'Tests', state: 'passed', detail: '186 tests · 1 min 52 s', href: null } },
    { name: 'échoué', data: { name: 'Lint', state: 'failed', detail: '3 erreurs', href: '#lint' } },
    { name: 'en cours', data: { name: 'Build', state: 'running', detail: null, href: null } },
  ],
});
