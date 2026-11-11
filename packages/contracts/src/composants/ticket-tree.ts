import { z } from 'zod';
import { defineComposant } from './define.js';
import { zTicketRowState } from './ticket-row-state.js';

const zNode = z.object({
  number: z.int().positive(),
  title: z.string(),
  state: zTicketRowState,
  depth: z.int().nonnegative(),
  blockedBy: z.string().nullable(),
  critical: z.boolean(),
  href: z.string().nullable(),
});

/**
 * The tree of the open Tickets of a Projet (PILOTAGE-1): each Ticket under
 * the one blocking it (`depth`), with what blocks it, the critical path in
 * bold. The view orders the nodes and computes their depth.
 */
export const TicketTree = defineComposant({
  name: 'TicketTree',
  version: 1,
  tag: 'cd-ticket-tree',
  category: 'partie',
  description: 'L’arbre des Tickets ouverts : chacun sous celui qui le bloque, le chemin critique en gras.',
  data: z.object({ nodes: z.array(zNode) }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'un Projet',
      data: {
        nodes: [
          { number: 51, title: 'Rappels de l’agenda', state: 'interrompu', depth: 0, blockedBy: null, critical: true, href: null },
          { number: 56, title: 'Fuseau horaire des rappels', state: 'attente', depth: 1, blockedBy: '#51', critical: true, href: null },
          { number: 57, title: 'Rappels par notification', state: 'attente', depth: 2, blockedBy: '#56', critical: true, href: null },
          { number: 38, title: 'Page Planning', state: 'revue-visuelle', depth: 0, blockedBy: null, critical: false, href: '#38' },
          { number: 58, title: 'Impression du planning', state: 'attente', depth: 1, blockedBy: '#38', critical: false, href: null },
          { number: 53, title: 'Export du planning', state: 'en-review', depth: 0, blockedBy: null, critical: false, href: null },
        ],
      },
    },
  ],
});
