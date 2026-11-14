import { z } from 'zod';
import { zCursorPage, zId, zInstant } from '../values.js';

/**
 * The kinds of Décision (US-17): what waits for the Pilote. Each is raised and
 * resolved by its own module; « À toi » shows its label (`decision.kind.<kind>`).
 */
export const DECISION_KINDS = [
  'ticket-blocked',
  'ticket-interrupted',
  'permission-requested',
  'agent-question',
  'limit-reached',
  'ai-account-disconnected',
  'visual-review',
  'document-review',
  'inventory-review',
  'ticket-draft',
  'contract-incomplete',
  'step-failed',
  'runner-offline',
  'ideas-to-triage',
] as const;
export const zDecisionKind = z.enum(DECISION_KINDS);
export type DecisionKind = z.infer<typeof zDecisionKind>;

/** The tone of its rail and its icon, the raising module's choice: halt blocked, caution waiting, accent the rest. */
export const DECISION_TONES = ['accent', 'caution', 'halt'] as const;
export const zDecisionTone = z.enum(DECISION_TONES);
export type DecisionTone = z.infer<typeof zDecisionTone>;

/** Open while it waits for the Pilote; resolved by its module, kept for the history. */
export const DECISION_STATES = ['open', 'resolved'] as const;
export const zDecisionState = z.enum(DECISION_STATES);
export type DecisionState = z.infer<typeof zDecisionState>;

/** The bounds of a Décision's short texts: what one row shows. */
export const DECISION_LABEL_MAX = 120;
export const DECISION_META_PARTS_MAX = 3;
export const DECISION_META_PART_MAX = 40;

/** A value of `params`: flat, for the kind's view (a Ticket's number, a reset's instant). */
export const zDecisionParam = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A Décision (ADR 0003: what the server may read): its kind, its object
 * (`subjectType`, `subjectId`: a Ticket's number, a Session's id), a short
 * `label` (its title, after its kind), `metaParts` (readable facts such as
 * « Code », « session », « 4 captures »), its `link` (a page URL) and the
 * `params` of its kind's view. Never free text of the Pilote or an agent: the
 * page reads that from GitHub or the Runner. `GET /api/decisions`, the
 * `decisions` slice of `GET /api/state` (the open ones) and the payload of
 * `decision.upserted`; `decision.removed` once resolved.
 */
export const zDecision = z.object({
  id: zId,
  kind: zDecisionKind,
  projectId: zId.nullable(),
  projectName: z.string().min(1).nullable(),
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  label: z.string().min(1).max(DECISION_LABEL_MAX),
  metaParts: z.array(z.string().min(1).max(DECISION_META_PART_MAX)).max(DECISION_META_PARTS_MAX),
  tone: zDecisionTone,
  link: z.string().startsWith('/'),
  params: z.record(z.string(), zDecisionParam),
  state: zDecisionState,
  outcome: z.string().min(1).nullable(),
  createdAt: zInstant,
  resolvedAt: zInstant.nullable(),
});
export type Decision = z.infer<typeof zDecision>;

/**
 * `GET /api/decisions?state=open|resolved&projectId=&cursor=`: `state` is
 * mandatory (ADR 0008, « Lists »). `open` returns every open one; `resolved`
 * a page of 50, newest first, and the cursor of the next.
 */
export const zDecisionListQuery = z.object({
  state: zDecisionState,
  projectId: zId.optional(),
  cursor: z.string().min(1).optional(),
});
export type DecisionListQuery = z.infer<typeof zDecisionListQuery>;

export const zDecisionList = zCursorPage(zDecision);
export type DecisionList = z.infer<typeof zDecisionList>;
