import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';

/**
 * A Session running in a Boucle (ATOI-1, BOUCLE-1): its Projet and Ticket,
 * the Étape it is at in a chip of its tone, its Moteur and since when. Its
 * dot is haloed while it runs (`go`). The whole row opens the Session panel.
 */
export const AgentRow = defineComposant({
  name: 'AgentRow',
  version: 1,
  tag: 'cd-agent-row',
  category: 'partie',
  description: 'Une Session en cours : son Projet, son Ticket, son Étape et son Moteur ; elle ouvre la Session.',
  data: z.object({
    sessionId: zId,
    projet: z.string(),
    ticket: z.string(),
    step: z.string(),
    engine: z.string(),
    since: z.string(),
    tone: z.enum(['go', 'accent', 'caution', 'halt']),
  }),
  actions: { open: z.object({ sessionId: zId }) },
  slots: [],
  examples: [
    {
      name: 'en review',
      data: {
        sessionId: '0193a4f2-7c1e-7a10-8d2c-000000000001',
        projet: 'Personal OS',
        ticket: '#53 Export du planning',
        step: 'en review',
        engine: 'Codex',
        since: 'depuis 6 min',
        tone: 'go',
      },
    },
    {
      name: 'attend ta permission',
      data: {
        sessionId: '0193a4f2-7c1e-7a10-8d2c-000000000002',
        projet: 'Crewdeck',
        ticket: '#44 Liste des Projets',
        step: 'attend ta permission',
        engine: 'Claude Code',
        since: 'depuis 18 min',
        tone: 'caution',
      },
    },
  ],
});
