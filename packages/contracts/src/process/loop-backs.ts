import { CATALOGUE } from './catalogue.js';
import type { LoopBack, ProcessDefinition } from './definition.js';

/**
 * The Retours (ADR 0011, « A Retour »), pure: run by the page (a gate hides
 * its « Demander des changements ») and by the server's engine (a Verdict
 * « changements » takes the Retour, or stops the item) alike.
 */

/** The Retour that leaves `stepId` (one at most: `validateDefinition` refuses a second), `null` when none does. */
export const loopBackFrom = (definition: ProcessDefinition, stepId: string): LoopBack | null =>
  definition.loopBacks.find((loopBack) => loopBack.from === stepId) ?? null;

/** Whether `stepId` may ask for changes: it judges and a Retour leaves it. */
export const canAskChanges = (definition: ProcessDefinition, stepId: string): boolean => {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  return step !== undefined && CATALOGUE[step.kind].judges && loopBackFrom(definition, stepId) !== null;
};
