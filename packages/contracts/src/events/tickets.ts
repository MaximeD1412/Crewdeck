import { type CodeChange, type Milestone, type Ticket, zCodeChange, zMilestone, zTicket } from '../api/tickets.js';
import { registerEventPayload } from './index.js';

/** `ticket.upserted`: the Ticket as `GET /api/projects/:id/tickets` returns it; `ticket.removed` when its issue is deleted or transferred. */
export const zTicketEventPayload = registerEventPayload('ticket', zTicket);

/** `milestone.upserted`: the milestone, when created or changed; `milestone.removed` when deleted. */
export const zMilestoneEventPayload = registerEventPayload('milestone', zMilestone);

/** `code-change.upserted`: the change of code, when opened, pushed, checked or merged. */
export const zCodeChangeEventPayload = registerEventPayload('code-change', zCodeChange);

declare module './index.js' {
  interface EventPayloads {
    ticket: Ticket;
    milestone: Milestone;
    'code-change': CodeChange;
  }
}
