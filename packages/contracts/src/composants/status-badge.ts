import { z } from 'zod';
import { defineComposant } from './define.js';
import { zTone } from './tone.js';

/** A short state in a badge: « Mergé », « Bloqué ». */
export const StatusBadge = defineComposant({
  name: 'StatusBadge',
  version: 1,
  tag: 'cd-status-badge',
  category: 'signal',
  description: 'Un état court dans un badge.',
  data: z.object({ tone: zTone, label: z.string() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'neutre', data: { tone: 'neutral', label: 'libre' } },
    { name: 'accent', data: { tone: 'accent', label: 'En cours' } },
    { name: 'fait', data: { tone: 'go', label: 'Mergé' } },
    { name: 'attente', data: { tone: 'caution', label: 'Interrompu' } },
    { name: 'bloqué', data: { tone: 'halt', label: 'Bloqué' } },
  ],
});
