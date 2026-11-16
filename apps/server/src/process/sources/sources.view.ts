import type { ProcessSources, ProjectProcessSources } from '@crewdeck/contracts';
import type { SourceGroup, SourceKind } from '../../generated/prisma/client.js';

/** What of an `artifact_sources` row the view reads. */
export const ARTIFACT_SOURCE_VIEW = { projectId: true, group: true, source: true, since: true } as const;

export interface ArtifactSourceRow {
  readonly projectId: string;
  readonly group: SourceGroup;
  readonly source: SourceKind;
  readonly since: Date;
}

/**
 * The kinds alone, as `findGaps` reads them: `null` for a group without a
 * row, which a Projet never shows (both are written at its creation).
 */
export const toProcessSources = (rows: readonly ArtifactSourceRow[]): ProcessSources => {
  const sourceOf = (group: SourceGroup) => rows.find((row) => row.group === group)?.source ?? null;
  return { ticket: sourceOf('ticket'), code: sourceOf('code') };
};

/**
 * Both groups of a Projet in its Process's view. A group without a row
 * breaks the rule that a Projet holds both from its creation: a throw, not
 * a view the contract refuses.
 */
export const toProjectProcessSources = (projectId: string, rows: readonly ArtifactSourceRow[]): ProjectProcessSources => {
  const sourceOf = (group: SourceGroup) => {
    const row = rows.find((candidate) => candidate.group === group);
    if (!row) throw new Error(`project ${projectId} has no Source for its group ${group}`);
    return { source: row.source, since: row.since.toISOString() };
  };
  return { ticket: sourceOf('ticket'), code: sourceOf('code') };
};
