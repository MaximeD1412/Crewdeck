import type { ProjectProcess } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { activeVersions, readRunningWork } from './process.service.js';
import { PROCESS_DRAFT_VIEW, toProjectProcess } from './process.view.js';
import { ARTIFACT_SOURCE_VIEW, type ArtifactSourceRow, toProjectProcessSources } from './sources/sources.view.js';

/** The `processes` slice: every Projet's Process, its active version, its draft, its Sources and its work running, in the order of the Projets' ids. */
@Injectable()
export class ProcessState implements StateContributor<'processes'>, OnModuleInit {
  readonly key = 'processes';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<ProjectProcess[]> {
    const [projects, versions, drafts, sources, running] = await Promise.all([
      tx.project.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      activeVersions(tx),
      tx.processDraft.findMany({ select: PROCESS_DRAFT_VIEW }),
      tx.artifactSource.findMany({ select: ARTIFACT_SOURCE_VIEW }),
      readRunningWork(tx),
    ]);
    const versionOf = new Map(versions.map((row) => [row.projectId, row]));
    const draftOf = new Map(drafts.map((row) => [row.projectId, row]));
    const sourcesOf = new Map<string, ArtifactSourceRow[]>();
    for (const row of sources) sourcesOf.set(row.projectId, [...(sourcesOf.get(row.projectId) ?? []), row]);
    return projects.map(({ id }) =>
      toProjectProcess(id, versionOf.get(id) ?? null, draftOf.get(id) ?? null, toProjectProcessSources(id, sourcesOf.get(id) ?? []), running.get(id) ?? []),
    );
  }
}
