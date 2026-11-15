import { type BranchPrefix, TICKET_PRIORITIES, TICKET_SIZES, type TicketPriority, type TicketSize } from '@crewdeck/contracts';

/** The label that marks a Ticket ready for the Boucle on GitHub. */
export const READY_LABEL = 'ready-for-agent';
/** The label that holds a Ticket for the Pilote: never ready while it is there. */
export const NEEDS_HUMAN_LABEL = 'needs-human';
/** The label that asks for a Revue visuelle. */
export const VISUAL_REVIEW_LABEL = 'revue-visuelle';

const valueOf = <T extends string>(labels: readonly string[], prefix: string, values: readonly T[]): T | null => {
  for (const label of labels) {
    const value = label.startsWith(prefix) ? label.slice(prefix.length) : label;
    if ((values as readonly string[]).includes(value)) return value as T;
  }
  return null;
};

/** The priority of the first `P0`…`P2` or `priority:P0`… label, null without one. */
export const priorityOf = (labels: readonly string[]): TicketPriority | null => valueOf(labels, 'priority:', TICKET_PRIORITIES);

/** The size of the first `XS`…`XL` or `size:XS`… label, null without one. */
export const sizeOf = (labels: readonly string[]): TicketSize | null => valueOf(labels, 'size:', TICKET_SIZES);

/**
 * The labels the server reads of a Local Ticket (ADR 0012): `priority:*`,
 * `size:*`, `ready-for-agent` and `needs-human`; any other is sealed.
 */
export const productLabels = (labels: readonly string[]): string[] =>
  labels.filter((label) => label.startsWith('priority:') || label.startsWith('size:') || label === READY_LABEL || label === NEEDS_HUMAN_LABEL);

/** The prefix of a Ticket's branch: `fix` for `type:fix`, `chore` for `type:chore`, `feat` otherwise. */
export const branchPrefixOf = (labels: readonly string[]): BranchPrefix => {
  if (labels.includes('type:fix')) return 'fix';
  if (labels.includes('type:chore')) return 'chore';
  return 'feat';
};

/** Whether the Ticket asks for a Revue visuelle (`revue-visuelle`). */
export const visualReviewOf = (labels: readonly string[]): boolean => labels.includes(VISUAL_REVIEW_LABEL);
