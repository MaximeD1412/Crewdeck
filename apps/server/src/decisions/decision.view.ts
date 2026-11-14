import type { Decision } from '@crewdeck/contracts';

/** What of a `decisions` row the page sees: `GET /api/decisions`, the `decisions` slice of `GET /api/state`, the payload of `decision.upserted`. */
export const DECISION_VIEW = {
  id: true,
  kind: true,
  projectId: true,
  projectName: true,
  subjectType: true,
  subjectId: true,
  label: true,
  metaParts: true,
  tone: true,
  link: true,
  params: true,
  state: true,
  outcome: true,
  createdAt: true,
  resolvedAt: true,
} as const;

export interface DecisionRow {
  id: string;
  kind: string;
  projectId: string | null;
  projectName: string | null;
  subjectType: string;
  subjectId: string;
  label: string;
  metaParts: string[];
  tone: Decision['tone'];
  link: string;
  params: unknown;
  state: Decision['state'];
  outcome: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

/** The row as the contracts have it: `kind` and `params` were checked by `raise`, the dates in ISO. */
export const toDecision = (row: DecisionRow): Decision => ({
  ...row,
  kind: row.kind as Decision['kind'],
  params: row.params as Decision['params'],
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
});
