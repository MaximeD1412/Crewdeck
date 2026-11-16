import type { ProcessSources, ProjectProcessSources, SourceKind } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { newId } from '../../ids.js';
import type { Tx } from '../../realtime/transactions.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { ARTIFACT_SOURCE_VIEW, type ArtifactSourceRow, toProcessSources, toProjectProcessSources } from './sources.view.js';

/** The part of a transaction the Sources read and write. */
export type SourcesTx = Pick<Tx, 'artifactSource'>;

/** The rows of a Projet's Sources, in the current Pilote's scope. */
export const readSourceRows = (tx: SourcesTx, projectId: string): Promise<ArtifactSourceRow[]> =>
  tx.artifactSource.findMany({ where: { projectId }, select: ARTIFACT_SOURCE_VIEW });

/** Both groups of a Projet, as its Process's view holds them. */
export const readProjectProcessSources = async (tx: SourcesTx, projectId: string): Promise<ProjectProcessSources> =>
  toProjectProcessSources(projectId, await readSourceRows(tx, projectId));

/**
 * The Sources of a Projet (ADR 0012, « Which Source for what »): one row per
 * group, `ticket` and `code`, both written at its creation. No route
 * changes one: moving a group is the Action sensible `source.migrate`
 * (SOURCE-7).
 */
@Injectable()
export class SourcesService {
  /**
   * Both groups of a Projet just created at `kind`, since now, in its
   * transaction and before its Process (so that its first
   * `process.upserted` holds them): `github` for a Dépôt GitHub followed,
   * `local` for a folder (PROJET-6). A second call for the same Projet
   * fails on the unique `(projectId, group)`.
   */
  async createDefaults(tx: SourcesTx, projectId: string, kind: SourceKind): Promise<void> {
    const pilotId = currentPilotId();
    const since = new Date();
    await tx.artifactSource.createMany({
      data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId, projectId, group, source: kind, since })),
    });
  }

  /** The kinds of a Projet's groups, for `findGaps`. */
  async sourcesOf(tx: SourcesTx, projectId: string): Promise<ProcessSources> {
    return toProcessSources(await readSourceRows(tx, projectId));
  }

  /** Both groups of a Projet, with since when, as its Process's view holds them. */
  viewOf(tx: SourcesTx, projectId: string): Promise<ProjectProcessSources> {
    return readProjectProcessSources(tx, projectId);
  }
}
