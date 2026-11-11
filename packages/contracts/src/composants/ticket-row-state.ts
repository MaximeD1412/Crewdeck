import { z } from 'zod';

/**
 * The states of a Ticket as its row or its node of the ticket tree shows
 * them, each with its badge (`ticketRow.state.<state>`, `design/components.js`,
 * `TICKET`): the same list as UI-5's TicketRow.
 */
export const zTicketRowState = z
  .enum(['pret', 'en-cours', 'en-review', 'checks', 'bloque', 'revue-visuelle', 'interrompu', 'merge', 'attente'])
  .meta({ title: 'TicketRowState' });
export type TicketRowState = z.infer<typeof zTicketRowState>;
