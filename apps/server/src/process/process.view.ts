import {
  type ProcessDraft,
  type ProcessRunningWork,
  type ProcessVersion,
  type ProjectProcess,
  type ProjectProcessSources,
  type SealedItem,
  zArtifactType,
  zProcessDefinition,
  zSealedItem,
} from '@crewdeck/contracts';
import type { ProcessActivation } from '../generated/prisma/client.js';

/** What of a `process_versions` row the view reads. */
export const PROCESS_VERSION_VIEW = {
  projectId: true,
  number: true,
  definition: true,
  sealed: true,
  activatedAt: true,
  activatedBy: true,
  templateName: true,
} as const;

/** What of a `process_drafts` row the view reads. */
export const PROCESS_DRAFT_VIEW = {
  projectId: true,
  definition: true,
  sealed: true,
  revision: true,
  baseVersion: true,
  updatedAt: true,
} as const;

export interface ProcessVersionRow {
  readonly projectId: string;
  readonly number: number;
  readonly definition: unknown;
  readonly sealed: unknown;
  readonly activatedAt: Date;
  readonly activatedBy: ProcessActivation;
  readonly templateName: string | null;
}

export interface ProcessDraftRow {
  readonly projectId: string;
  readonly definition: unknown;
  readonly sealed: unknown;
  readonly revision: number;
  readonly baseVersion: number;
  readonly updatedAt: Date;
}

/** What of a `phase_runs` row at work the view reads: its version's number, and its Ticket's when it carries one. */
export const RUNNING_WORK_VIEW = {
  id: true,
  projectId: true,
  itemType: true,
  itemId: true,
  processVersion: { select: { number: true } },
} as const;

export interface RunningWorkRow {
  readonly id: string;
  readonly projectId: string | null;
  readonly itemType: string;
  readonly itemId: string;
  readonly processVersion: { readonly number: number } | null;
}

/** A PhaseRun at work as the view lists it; `ticketNumbers` maps a Ticket's id to its number. */
export const toRunningWork = (row: RunningWorkRow, ticketNumbers: ReadonlyMap<string, number>): ProcessRunningWork[] =>
  row.processVersion === null
    ? []
    : [
        {
          phaseRunId: row.id,
          versionNumber: row.processVersion.number,
          itemType: zArtifactType.parse(row.itemType),
          itemId: row.itemId,
          ticketNumber: row.itemType === 'ticket' ? (ticketNumbers.get(row.itemId) ?? null) : null,
        },
      ];

/** The sealed part as stored: `null`, or the item received, never opened. */
const sealedOf = (value: unknown): SealedItem | null => (value === null || value === undefined ? null : zSealedItem.parse(value));

export const toProcessVersion = (row: ProcessVersionRow): ProcessVersion => ({
  number: row.number,
  definition: zProcessDefinition.parse(row.definition),
  sealed: sealedOf(row.sealed),
  activatedAt: row.activatedAt.toISOString(),
  activatedBy: row.activatedBy,
  templateName: row.templateName,
});

export const toProcessDraft = (row: ProcessDraftRow): ProcessDraft => ({
  definition: zProcessDefinition.parse(row.definition),
  sealed: sealedOf(row.sealed),
  revision: row.revision,
  baseVersion: row.baseVersion,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * A Projet's whole Process (`GET /api/projects/:id/process`, the `processes`
 * slice, `process.upserted`): its active version, the highest number, its
 * draft, the Sources of its groups, and its work running on a version;
 * keyed by the Projet's id.
 */
export const toProjectProcess = (
  projectId: string,
  version: ProcessVersionRow | null,
  draft: ProcessDraftRow | null,
  sources: ProjectProcessSources,
  running: readonly ProcessRunningWork[],
): ProjectProcess => ({
  id: projectId,
  active: version ? toProcessVersion(version) : null,
  draft: draft ? toProcessDraft(draft) : null,
  sources,
  running: [...running],
});
