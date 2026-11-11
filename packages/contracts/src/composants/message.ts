import { z } from 'zod';
import { zInstant } from '../values.js';
import { defineComposant } from './define.js';

/**
 * A message of a Session: the agent's text as Markdown, never raw HTML (it
 * comes from a model), the Pilote's as plain text.
 */
export const Message = defineComposant({
  name: 'Message',
  version: 1,
  tag: 'cd-message',
  category: 'partie',
  description: 'Un message d’une Session, de l’agent ou du Pilote.',
  data: z.object({ from: z.enum(['agent', 'pilote']), text: z.string(), at: zInstant }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'de l’agent',
      data: {
        from: 'agent',
        text: 'Noté. L’agenda actuel a déjà les **événements récurrents** ; il manque :\n\n- qui voit un agenda partagé ;\n- qui peut modifier ses événements.\n\nJe lis [le PRD](https://github.com/MaximeD1412/Crewdeck) avant de te poser mes questions.',
        at: '2026-11-11T14:02:00.000Z',
      },
    },
    { name: 'du Pilote', data: { from: 'pilote', text: 'Pense aux événements récurrents.', at: '2026-11-11T14:03:00.000Z' } },
  ],
});
