import type { ProcessDefinition, ProcessRunningWork } from '@crewdeck/contracts';

/** What a PhaseRun at work is about: a Ticket, a Conception (an Idée retenue), an Idée, or another item. */
export type WorkKind = 'ticket' | 'design' | 'idea' | 'other';
export const WORK_KINDS: readonly WorkKind[] = ['ticket', 'design', 'idea', 'other'];

/**
 * The kind of a PhaseRun at work: a Ticket by its type, an Idée by its
 * Phase's « pour chaque » in the first of `definitions` that has the Phase
 * (ids match across versions, ADR 0011), else another item.
 */
export const workKindOf = (work: ProcessRunningWork, definitions: readonly (ProcessDefinition | undefined)[]): WorkKind => {
  if (work.itemType === 'ticket') return 'ticket';
  if (work.itemType !== 'idea') return 'other';
  const phase = definitions.flatMap((definition) => definition?.phases ?? []).find((candidate) => candidate.id === work.phaseId);
  if (!phase) return 'other';
  return phase.forEach === 'idea.retained' ? 'design' : 'idea';
};

export interface VersionWork {
  readonly versionNumber: number;
  /** Its PhaseRuns by kind, in the order of `WORK_KINDS`, kinds without any left out; each in the order given. */
  readonly kinds: readonly { readonly kind: WorkKind; readonly works: readonly ProcessRunningWork[] }[];
}

/** The work at work by version, the newest version first: what stays on its version once another is activated. */
export const runningByVersion = (running: readonly ProcessRunningWork[], definitions: readonly (ProcessDefinition | undefined)[]): VersionWork[] => {
  const versions = [...new Set(running.map((work) => work.versionNumber))].sort((a, b) => b - a);
  return versions.map((versionNumber) => {
    const works = running.filter((work) => work.versionNumber === versionNumber);
    return {
      versionNumber,
      kinds: WORK_KINDS.map((kind) => ({ kind, works: works.filter((work) => workKindOf(work, definitions) === kind) })).filter((group) => group.works.length > 0),
    };
  });
};
