import type { TicketState } from '@crewdeck/contracts';
import { NEEDS_HUMAN_LABEL } from './labels.js';

/** What a Ticket's readiness reads of it. */
export interface ReadinessOf {
  readonly state: TicketState;
  readonly readyMark: boolean;
  readonly labels: readonly string[];
  readonly blockedBy: readonly number[];
}

/**
 * Whether the Boucle may take a Ticket: open, marked ready, without
 * `needs-human`, and every Ticket it is blocked by closed. A blocker not
 * among `ticketsByNumber` (unknown, or in another repository) counts as open.
 */
export const isReady = (ticket: ReadinessOf, ticketsByNumber: ReadonlyMap<number, { readonly state: TicketState }>): boolean =>
  ticket.state === 'open' &&
  ticket.readyMark &&
  !ticket.labels.includes(NEEDS_HUMAN_LABEL) &&
  ticket.blockedBy.every((number) => ticketsByNumber.get(number)?.state === 'closed');
