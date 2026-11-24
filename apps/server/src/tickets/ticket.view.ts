import type { CodeChange, CodeChangeCheck, Milestone, SealedItem, Ticket } from '@crewdeck/contracts';
import type { Prisma } from '../generated/prisma/client.js';

/** What of a `tickets` row the page sees: the routes, the `tickets` slice, `ticket.upserted`. */
export const TICKET_VIEW = {
  id: true,
  projectId: true,
  source: true,
  number: true,
  title: true,
  titleSealed: true,
  state: true,
  stateReason: true,
  closedAt: true,
  readyMark: true,
  ready: true,
  labels: true,
  labelsSealed: true,
  priority: true,
  size: true,
  milestoneNumber: true,
  blockedBy: true,
  parentNumber: true,
  formerNumber: true,
  formerSource: true,
  branchPrefix: true,
  visualReview: true,
  sourceCreatedAt: true,
  sourceUpdatedAt: true,
  updatedAt: true,
} as const satisfies Prisma.TicketSelect;

export const MILESTONE_VIEW = {
  id: true,
  projectId: true,
  source: true,
  number: true,
  rank: true,
  title: true,
  titleSealed: true,
  state: true,
  dueOn: true,
  openCount: true,
  closedCount: true,
  closedAt: true,
} as const satisfies Prisma.MilestoneSelect;

export const CODE_CHANGE_VIEW = {
  id: true,
  projectId: true,
  source: true,
  number: true,
  ticketNumber: true,
  title: true,
  titleSealed: true,
  state: true,
  headRef: true,
  baseRef: true,
  headSha: true,
  checks: true,
  checksSha: true,
  mergedAt: true,
  mergedBy: true,
  mergeSha: true,
  sourceCreatedAt: true,
  formerNumber: true,
  formerSource: true,
  updatedAt: true,
} as const satisfies Prisma.CodeChangeSelect;

export const CHECK_VIEW = { id: true, codeChangeId: true, sha: true, name: true, state: true, durationMs: true, url: true } as const satisfies Prisma.CodeChangeCheckSelect;

export type TicketRow = Prisma.TicketGetPayload<{ select: typeof TICKET_VIEW }>;
export type MilestoneRow = Prisma.MilestoneGetPayload<{ select: typeof MILESTONE_VIEW }>;
export type CodeChangeRow = Prisma.CodeChangeGetPayload<{ select: typeof CODE_CHANGE_VIEW }>;
export type CheckRow = Prisma.CodeChangeCheckGetPayload<{ select: typeof CHECK_VIEW }>;

/** A sealed column as the Runner wrote it (`{ key, ciphertext }`), checked by the contracts' schema on the way out. */
const sealed = (value: Prisma.JsonValue): SealedItem | null => (value === null ? null : (value as unknown as SealedItem));
const instant = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export const toTicket = (row: TicketRow): Ticket => ({
  ...row,
  titleSealed: sealed(row.titleSealed),
  labelsSealed: sealed(row.labelsSealed),
  closedAt: instant(row.closedAt),
  sourceCreatedAt: row.sourceCreatedAt.toISOString(),
  sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toMilestone = (row: MilestoneRow): Milestone => ({
  ...row,
  titleSealed: sealed(row.titleSealed),
  dueOn: row.dueOn === null ? null : row.dueOn.toISOString().slice(0, 10),
  closedAt: instant(row.closedAt),
});

export const toCodeChange = (row: CodeChangeRow): CodeChange => ({
  ...row,
  titleSealed: sealed(row.titleSealed),
  mergedAt: instant(row.mergedAt),
  sourceCreatedAt: row.sourceCreatedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toCheck = (row: CheckRow): CodeChangeCheck => row;
