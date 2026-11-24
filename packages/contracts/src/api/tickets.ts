import { z } from 'zod';
import { zSha } from '../github/index.js';
import { zSealedItem } from '../keys/sealed.js';
import { zCursorPage, zDay, zId, zInstant } from '../values.js';

/**
 * Where a row of `tickets`, `milestones` or `code_changes` comes from (ADR
 * 0012): GitHub, its free texts readable, or Local, its free texts sealed by
 * the Runner under the vault key.
 */
export const TICKET_SOURCES = ['github', 'local'] as const;
export const zTicketSource = z.enum(TICKET_SOURCES);
export type TicketSource = z.infer<typeof zTicketSource>;

/** A Ticket, a milestone or a change of code is open or closed at its Source. */
export const TICKET_STATES = ['open', 'closed'] as const;
export const zTicketState = z.enum(TICKET_STATES);
export type TicketState = z.infer<typeof zTicketState>;

/** Why a Ticket closed, in GitHub's spelling. */
export const TICKET_STATE_REASONS = ['completed', 'not_planned'] as const;
export const zTicketStateReason = z.enum(TICKET_STATE_REASONS);
export type TicketStateReason = z.infer<typeof zTicketStateReason>;

/** A Ticket's priority, from its labels (`P1` or `priority:P1`); none sorts last. */
export const TICKET_PRIORITIES = ['P0', 'P1', 'P2'] as const;
export const zTicketPriority = z.enum(TICKET_PRIORITIES);
export type TicketPriority = z.infer<typeof zTicketPriority>;

/** A Ticket's size, from its labels (`S` or `size:S`); none sorts last. */
export const TICKET_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export const zTicketSize = z.enum(TICKET_SIZES);
export type TicketSize = z.infer<typeof zTicketSize>;

/** The prefix of the branch the Boucle opens for a Ticket. */
export const BRANCH_PREFIXES = ['feat', 'fix', 'chore'] as const;
export const zBranchPrefix = z.enum(BRANCH_PREFIXES);
export type BranchPrefix = z.infer<typeof zBranchPrefix>;

/** The number of an issue, a milestone or a pull request at its Source. */
export const zSourceNumber = z.int().positive();

/** A Ticket's number in a path (`/api/projects/:id/tickets/:number`). */
export const zTicketNumber = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform(Number)
  .pipe(zSourceNumber);

/** GitHub's rows have a readable title and no sealed one; Local's the reverse (the database checks it too). */
const titledBySource = (row: { source: TicketSource; title: string | null; titleSealed: unknown }) =>
  row.source === 'github' ? row.title !== null && row.titleSealed === null : row.title === null && row.titleSealed !== null;
const TITLE_BY_SOURCE = { message: 'title for github, titleSealed for local', path: ['title'] };

/**
 * A row a migration just moved (SOURCE-8) has neither title until its new
 * Source fills it: the reconciliation to GitHub, the Runner's scan to Local.
 */
const untitled = (row: { title: string | null; titleSealed: unknown }) => row.title === null && row.titleSealed === null;
const ticketTitled = (row: { source: TicketSource; title: string | null; titleSealed: unknown; labelsSealed: unknown; formerSource: TicketSource | null }) =>
  titledBySource(row) || (row.formerSource !== null && row.formerSource !== row.source && untitled(row) && row.labelsSealed === null);
const codeChangeTitled = (row: { source: TicketSource; title: string | null; titleSealed: unknown; formerSource?: TicketSource | null | undefined }) =>
  titledBySource(row) || (row.formerSource != null && row.formerSource !== row.source && untitled(row));
const milestoneTitled = (row: { source: TicketSource; title: string | null; titleSealed: unknown }) => titledBySource(row) || untitled(row);

/**
 * A Ticket of a Projet (US-15, US-16), the same shape whatever its Source:
 * its number, state, the readable labels (all of GitHub's; the product's only
 * for Local, the others in `labelsSealed`), the figures the Boucle reads
 * (`priority`, `size`, `branchPrefix`, `visualReview`), its native blocked-by
 * (numbers of the same Projet) and parent, and `ready`, stored: open,
 * `readyMark`, no `needs-human` and every blocker closed. Never a body.
 * `formerNumber` and `formerSource` are its number and Source before a
 * migration moved it (SOURCE-8), shown « ex-#12 »; null for a Ticket never moved.
 * A moved row has no title until its new Source fills it.
 */
export const zTicket = z
  .object({
    id: zId,
    projectId: zId,
    source: zTicketSource,
    number: zSourceNumber,
    title: z.string().min(1).nullable(),
    titleSealed: zSealedItem.nullable(),
    state: zTicketState,
    stateReason: zTicketStateReason.nullable(),
    closedAt: zInstant.nullable(),
    readyMark: z.boolean(),
    ready: z.boolean(),
    labels: z.array(z.string().min(1)),
    labelsSealed: zSealedItem.nullable(),
    priority: zTicketPriority.nullable(),
    size: zTicketSize.nullable(),
    milestoneNumber: zSourceNumber.nullable(),
    blockedBy: z.array(zSourceNumber),
    parentNumber: zSourceNumber.nullable(),
    formerNumber: zSourceNumber.nullable(),
    formerSource: zTicketSource.nullable(),
    branchPrefix: zBranchPrefix,
    visualReview: z.boolean(),
    sourceCreatedAt: zInstant,
    sourceUpdatedAt: zInstant,
    updatedAt: zInstant,
  })
  .refine(ticketTitled, TITLE_BY_SOURCE);
export type Ticket = z.infer<typeof zTicket>;

/**
 * A milestone of a Projet: its `rank`, readable for both Sources (GitHub's
 * number, the order of `tickets/milestones.yml` for Local), so that Tickets
 * sort by milestone without opening a title; its due day and its counts.
 */
export const zMilestone = z
  .object({
    id: zId,
    projectId: zId,
    source: zTicketSource,
    number: zSourceNumber,
    rank: z.int().nonnegative(),
    title: z.string().min(1).nullable(),
    titleSealed: zSealedItem.nullable(),
    state: zTicketState,
    dueOn: zDay.nullable(),
    openCount: z.int().nonnegative(),
    closedCount: z.int().nonnegative(),
    closedAt: zInstant.nullable(),
  })
  .refine(milestoneTitled, TITLE_BY_SOURCE);
export type Milestone = z.infer<typeof zMilestone>;

/** A change of code (a pull request on GitHub). */
export const CODE_CHANGE_STATES = ['draft', 'open', 'merged', 'closed'] as const;
export const zCodeChangeState = z.enum(CODE_CHANGE_STATES);
export type CodeChangeState = z.infer<typeof zCodeChangeState>;

/** The checks of a change of code's head: none yet, one still running, one failed, or all passed. */
export const CHECKS_STATES = ['none', 'pending', 'passed', 'failed'] as const;
export const zChecksState = z.enum(CHECKS_STATES);
export type ChecksState = z.infer<typeof zChecksState>;

/** Who merged: the Boucle (`crewdeck[bot]`) or the Pilote (anyone else). */
export const MERGED_BY = ['loop', 'pilot'] as const;
export const zMergedBy = z.enum(MERGED_BY);
export type MergedBy = z.infer<typeof zMergedBy>;

/**
 * A change of code: the Ticket it delivers (`ticketNumber`, from its head
 * branch `feat/<n>-…` only), its state, head and base, the `checks` of its
 * head (`checksSha` the commit they stand on), and how it merged.
 */
export const zCodeChange = z
  .object({
    id: zId,
    projectId: zId,
    source: zTicketSource,
    number: zSourceNumber,
    ticketNumber: zSourceNumber.nullable(),
    title: z.string().min(1).nullable(),
    titleSealed: zSealedItem.nullable(),
    state: zCodeChangeState,
    headRef: z.string().min(1).nullable(),
    baseRef: z.string().min(1),
    headSha: zSha.nullable(),
    checks: zChecksState,
    checksSha: zSha.nullable(),
    mergedAt: zInstant.nullable(),
    mergedBy: zMergedBy.nullable(),
    mergeSha: zSha.nullable(),
    sourceCreatedAt: zInstant,
    /** Its number and Source before a migration of the code moved it (SOURCE-9), untitled until its new Source fills it. */
    formerNumber: zSourceNumber.nullable().optional(),
    formerSource: zTicketSource.nullable().optional(),
    updatedAt: zInstant,
  })
  .refine(codeChangeTitled, TITLE_BY_SOURCE);
export type CodeChange = z.infer<typeof zCodeChange>;

/** One check of a commit: running, passed or failed. */
export const CHECK_STATES = ['running', 'passed', 'failed'] as const;
export const zCheckState = z.enum(CHECK_STATES);
export type CheckState = z.infer<typeof zCheckState>;

/** A check run or a commit status of a change of code, on one commit. */
export const zCodeChangeCheck = z.object({
  id: zId,
  codeChangeId: zId,
  sha: zSha,
  name: z.string().min(1),
  state: zCheckState,
  durationMs: z.int().nonnegative().nullable(),
  url: z.url().nullable(),
});
export type CodeChangeCheck = z.infer<typeof zCodeChangeCheck>;

/** The page of `GET /api/projects/:id/tickets`. */
export const TICKETS_PAGE = 50;

/** `GET /api/projects/:id/tickets?state=open|closed&cursor=`: every state when none, by number descending. */
export const zTicketListQuery = z.object({
  state: zTicketState.optional(),
  cursor: z.string().min(1).optional(),
});
export type TicketListQuery = z.infer<typeof zTicketListQuery>;

export const zTicketList = zCursorPage(zTicket);
export type TicketList = z.infer<typeof zTicketList>;

/**
 * `GET /api/projects/:id/tickets/:number`: the Ticket, its changes of code
 * (newest first) and the checks of the latest one's head.
 */
export const zTicketDetail = z.object({
  ticket: zTicket,
  codeChanges: z.array(zCodeChange),
  checks: z.array(zCodeChangeCheck),
});
export type TicketDetail = z.infer<typeof zTicketDetail>;
