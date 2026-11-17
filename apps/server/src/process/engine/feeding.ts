import { type Arrow, type ArtifactRef, FOR_EACH, type Phase, type PhaseRun, type ProcessDefinition, type Step, type StepRun, type StepRunInput } from '@crewdeck/contracts';

/**
 * The engine's rules (ADR 0011, « The engine »), pure: which Étapes of a
 * PhaseRun's Phase are ready and what feeds their Entrées, which Étapes a
 * rerun undoes, which StepRuns still count. `Engine` writes what they say;
 * no database here.
 */

/** What of a PhaseRun the feeding reads. */
export type FeedingPhaseRun = Pick<PhaseRun, 'phaseId' | 'itemType' | 'itemId'>;

/** What of a StepRun the feeding reads; `id`s are UUIDv7, in the order the StepRuns were created. */
export type FeedingStepRun = Pick<StepRun, 'id' | 'stepId' | 'state' | 'iteration' | 'outputs'>;

/** A PhaseRun of the lineage (`lineage.ts`'s `ancestors`): its id and its StepRuns, whatever the version it ran on. */
export interface Ancestor {
  readonly id: string;
  readonly stepRuns: readonly FeedingStepRun[];
}

/** An Étape ready to start, with what feeds each of its Entrées. */
export interface ReadyStep {
  readonly stepId: string;
  readonly inputs: StepRunInput[];
}

const byCreation = <T extends { id: string }>(runs: readonly T[]): T[] => [...runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const phaseOf = (definition: ProcessDefinition, phaseId: string): Phase | undefined => definition.phases.find((phase) => phase.id === phaseId);

/** The type of the items a Phase repeats for, `null` without `forEach`. */
const itemTypeOf = (phase: Phase | undefined) => (phase?.forEach ? FOR_EACH[phase.forEach].type : null);

/**
 * The latest StepRun of each Étape that is not `superseded`, in the order
 * they were created: what says where the PhaseRun stands. A `failed` one a
 * `retry` followed no longer counts; it stays for the history.
 */
export const currentStepRuns = <T extends FeedingStepRun>(stepRuns: readonly T[]): T[] => {
  const latest = new Map<string, T>();
  for (const run of byCreation(stepRuns)) if (run.state !== 'superseded') latest.set(run.stepId, run);
  return byCreation([...latest.values()]);
};

/** The latest `done` StepRun of `stepId` (a `superseded` one is no longer `done`). */
const latestDone = (stepRuns: readonly FeedingStepRun[], stepId: string): FeedingStepRun | undefined =>
  byCreation(stepRuns.filter((run) => run.stepId === stepId && run.state === 'done')).at(-1);

/**
 * What an arrow from another Phase brings by lineage: the outputs on its
 * Sortie of the latest `done` StepRun of its Étape in the nearest ancestor
 * that ran it (Étape ids are stable across versions: an ancestor on another
 * version answers), none without one. Of the item's own type (a Phase
 * without `forEach`, started by that Artefact), only the item.
 */
const fromLineage = (ancestors: readonly Ancestor[], arrow: Arrow, phaseRun: FeedingPhaseRun): ArtifactRef[] => {
  for (const ancestor of ancestors) {
    const done = latestDone(ancestor.stepRuns, arrow.from.stepId);
    if (!done) continue;
    return done.outputs.filter((output) => output.portId === arrow.from.portId && (output.type !== phaseRun.itemType || output.id === phaseRun.itemId));
  }
  return [];
};

/**
 * What feeds the Entrée `portId` of `step`, or `null` while it cannot be
 * resolved:
 * - no arrow reaches it: the item, when the Entrée has the Phase's `forEach` type;
 * - an arrow from an Étape of the same Phase: the outputs on that Sortie of
 *   the latest `done` StepRun of that Étape (`superseded` ones ignored),
 *   unresolved while there are none;
 * - an arrow from another Phase: the item when its type is the Phase's
 *   `forEach` type, otherwise by lineage (`fromLineage`), resolved even with
 *   no Artefact: the Entrée is then « absente » and the Étape runs.
 */
const resolveInput = (
  definition: ProcessDefinition,
  phaseRun: FeedingPhaseRun,
  stepRuns: readonly FeedingStepRun[],
  ancestors: readonly Ancestor[],
  step: Step,
  portId: string,
  type: string,
): ArtifactRef[] | null => {
  const itemType = itemTypeOf(phaseOf(definition, phaseRun.phaseId));
  const item: ArtifactRef[] = [{ portId, type: phaseRun.itemType, id: phaseRun.itemId }];
  const arrows = definition.arrows.filter((arrow) => arrow.to.stepId === step.id && arrow.to.portId === portId);
  if (arrows.length === 0) return type === itemType ? item : null;

  const artifacts: ArtifactRef[] = [];
  for (const arrow of arrows) {
    const from = definition.steps.find((candidate) => candidate.id === arrow.from.stepId);
    if (!from) return null;
    if (from.phaseId !== step.phaseId) {
      artifacts.push(...(type === itemType ? item : fromLineage(ancestors, arrow, phaseRun)));
      continue;
    }
    const done = latestDone(stepRuns, from.id);
    const outputs = done?.outputs.filter((output) => output.portId === arrow.from.portId) ?? [];
    if (outputs.length === 0) return null;
    artifacts.push(...outputs);
  }
  return artifacts;
};

/**
 * What feeds each Entrée of `step`, in its order, or `null` when one of them
 * is not resolved; an Entrée resolved with no Artefact is `absent`.
 * `ancestors`: the PhaseRun's lineage, nearest first.
 */
export const resolveInputs = (
  definition: ProcessDefinition,
  phaseRun: FeedingPhaseRun,
  stepRuns: readonly FeedingStepRun[],
  step: Step,
  ancestors: readonly Ancestor[] = [],
): StepRunInput[] | null => {
  const inputs: StepRunInput[] = [];
  for (const port of step.inputs) {
    const artifacts = resolveInput(definition, phaseRun, stepRuns, ancestors, step, port.id, port.type);
    if (artifacts === null) return null;
    inputs.push({ portId: port.id, artifacts, absent: artifacts.length === 0 });
  }
  return inputs;
};

/**
 * The Étapes of the PhaseRun's Phase, in the definition's order, that have
 * no StepRun yet (other than `superseded`) and whose every Entrée resolves.
 * An Étape runs at most once per PhaseRun and iteration: a `failed` one
 * waits for `retry`, a `superseded` one may run again. `ancestors`: the
 * PhaseRun's lineage, nearest first, for the arrows from another Phase.
 */
export const readySteps = (
  definition: ProcessDefinition,
  phaseRun: FeedingPhaseRun,
  stepRuns: readonly FeedingStepRun[],
  ancestors: readonly Ancestor[] = [],
): ReadyStep[] => {
  const live = stepRuns.filter((run) => run.state !== 'superseded');
  const started = new Set(live.map((run) => run.stepId));
  return definition.steps
    .filter((step) => step.phaseId === phaseRun.phaseId && !started.has(step.id))
    .flatMap((step) => {
      const inputs = resolveInputs(definition, phaseRun, live, step, ancestors);
      return inputs === null ? [] : [{ stepId: step.id, inputs }];
    });
};

/**
 * `stepId` and every Étape it reaches by arrows inside its Phase, in the
 * definition's order: what a rerun from `stepId` undoes.
 */
export const reachedFrom = (definition: ProcessDefinition, stepId: string): string[] => {
  const phaseId = definition.steps.find((step) => step.id === stepId)?.phaseId;
  const inPhase = new Set(definition.steps.filter((step) => step.phaseId === phaseId).map((step) => step.id));
  const reached = new Set([stepId]);
  const queue = [stepId];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    for (const arrow of definition.arrows) {
      if (arrow.from.stepId !== current || !inPhase.has(arrow.to.stepId) || reached.has(arrow.to.stepId)) continue;
      reached.add(arrow.to.stepId);
      queue.push(arrow.to.stepId);
    }
  }
  return definition.steps.filter((step) => reached.has(step.id)).map((step) => step.id);
};

/** The arrows from the Sorties of `stepId` to an Étape of another Phase: what may carry its outputs on. */
export const crossingArrows = (definition: ProcessDefinition, stepId: string): Arrow[] => {
  const phaseOfStep = (id: string) => definition.steps.find((step) => step.id === id)?.phaseId;
  const from = phaseOfStep(stepId);
  return definition.arrows.filter((arrow) => {
    if (arrow.from.stepId !== stepId) return false;
    const to = phaseOfStep(arrow.to.stepId);
    return to !== undefined && to !== from;
  });
};

/** Whether `to` is one of the first Entrées of the Phase `phaseId`: an Entrée of one of its Étapes that no arrow from inside the Phase reaches. */
export const isFirstEntry = (definition: ProcessDefinition, phaseId: string, to: Arrow['to']): boolean => {
  const step = definition.steps.find((candidate) => candidate.id === to.stepId && candidate.phaseId === phaseId);
  if (!step?.inputs.some((port) => port.id === to.portId)) return false;
  const inPhase = new Set(definition.steps.filter((candidate) => candidate.phaseId === phaseId).map((candidate) => candidate.id));
  return !definition.arrows.some((arrow) => arrow.to.stepId === to.stepId && arrow.to.portId === to.portId && inPhase.has(arrow.from.stepId));
};
