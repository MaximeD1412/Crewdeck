import type { ProcessDefinition, ProcessId } from './definition.js';
import { SOURCE_GROUPS, type SourceGroup, TYPE_SOURCE } from './sources.js';

/**
 * The groups of Source a Phase reads or writes (ADR 0012, « Moving a
 * Source »): those of the Types d'artefact of its Étapes' Entrées and
 * Sorties. A PhaseRun of a Phase touching a migrating group waits for the
 * migration; one touching only the Idée or the Livraison never does. In the
 * order of `SOURCE_GROUPS`; none for a Phase the definition lacks.
 */
export const groupsOfPhase = (definition: ProcessDefinition, phaseId: ProcessId): SourceGroup[] => {
  const touched = new Set<string>();
  for (const step of definition.steps) {
    if (step.phaseId !== phaseId) continue;
    for (const port of [...step.inputs, ...step.outputs]) touched.add(TYPE_SOURCE[port.type]);
  }
  return SOURCE_GROUPS.filter((group) => touched.has(group));
};
