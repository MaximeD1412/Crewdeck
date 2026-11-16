import { type ProcessDraft, type ProcessVersion, type ProjectProcess, type ProjectProcessSources, type SealedItem, zProcessDefinition, zSealedItem } from '@crewdeck/contracts';
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
 * draft, and the Sources of its groups; keyed by the Projet's id.
 */
export const toProjectProcess = (
  projectId: string,
  version: ProcessVersionRow | null,
  draft: ProcessDraftRow | null,
  sources: ProjectProcessSources,
): ProjectProcess => ({
  id: projectId,
  active: version ? toProcessVersion(version) : null,
  draft: draft ? toProcessDraft(draft) : null,
  sources,
});
