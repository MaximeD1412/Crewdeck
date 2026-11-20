import { type Idea, type IdeaState, zIdeaAnalysisRun, zSealedItem } from '@crewdeck/contracts';
import type { IdeaState as IdeaStateRow } from '../generated/prisma/client.js';

/** The database spells `to-triage` `to_triage` (Prisma's enum names), mapped to the contracts' value. */
const STATE_OF_ROW: Readonly<Record<IdeaStateRow, IdeaState>> = {
  analysing: 'analysing',
  to_triage: 'to-triage',
  analysed: 'analysed',
  retained: 'retained',
  merged: 'merged',
  rejected: 'rejected',
};

/** A row's state as the contracts spell it. */
export const ideaStateOf = (state: IdeaStateRow): IdeaState => STATE_OF_ROW[state];

export const ideaStateRow = (state: IdeaState): IdeaStateRow =>
  (Object.entries(STATE_OF_ROW) as [IdeaStateRow, IdeaState][]).find(([, value]) => value === state)?.[0] ?? 'to_triage';

/** What of an `ideas` row the page sees: `GET /api/ideas`, the `ideas` slice, the payload of `idea.upserted`. */
export const IDEA_VIEW = {
  id: true,
  number: true,
  projectId: true,
  targetProjectId: true,
  targetIsNew: true,
  state: true,
  text: true,
  analysis: true,
  impact: true,
  effort: true,
  duplicateIds: true,
  notedFrom: true,
  dictated: true,
  mergedIntoId: true,
  reason: true,
  ticketNumber: true,
  createdAt: true,
  updatedAt: true,
  analysedAt: true,
  triagedAt: true,
  analysisRun: true,
} as const;

export interface IdeaRow {
  id: string;
  number: number;
  projectId: string | null;
  targetProjectId: string | null;
  targetIsNew: boolean;
  state: IdeaStateRow;
  text: unknown;
  analysis: unknown;
  impact: number | null;
  effort: number | null;
  duplicateIds: string[];
  notedFrom: Idea['notedFrom'];
  dictated: boolean;
  mergedIntoId: string | null;
  reason: unknown;
  ticketNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
  analysedAt: Date | null;
  triagedAt: Date | null;
  analysisRun: unknown;
}

/** A sealed field as stored (`{ key, ciphertext }`, written from a checked body): read back through its schema. */
const sealed = (value: unknown) => (value === null ? null : zSealedItem.parse(value));

/** The row as the contracts have it: the state's spelling, the sealed fields, the dates in ISO. */
export const toIdea = (row: IdeaRow): Idea => ({
  ...row,
  state: STATE_OF_ROW[row.state],
  text: zSealedItem.parse(row.text),
  analysis: sealed(row.analysis),
  reason: sealed(row.reason),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  analysedAt: row.analysedAt?.toISOString() ?? null,
  triagedAt: row.triagedAt?.toISOString() ?? null,
  analysisRun: row.analysisRun === null ? null : zIdeaAnalysisRun.parse(row.analysisRun),
});
