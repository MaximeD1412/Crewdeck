import { z } from 'zod';
import { defineComposant } from './define.js';
import { zTone } from './tone.js';

/** A dot of colour for a state; `pulse` when it is live. `label` is read by screen readers only. */
export const StatusDot = defineComposant({
  name: 'StatusDot',
  version: 1,
  tag: 'cd-status-dot',
  category: 'signal',
  description: 'Un point de couleur pour un état, qui pulse quand il est en direct.',
  data: z.object({ tone: zTone, pulse: z.boolean(), label: z.string() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'en ligne', data: { tone: 'go', pulse: false, label: 'Runner en ligne' } },
    { name: 'en direct', data: { tone: 'accent', pulse: true, label: 'Session en cours' } },
    { name: 'hors ligne', data: { tone: 'halt', pulse: false, label: 'Runner hors ligne' } },
  ],
});
