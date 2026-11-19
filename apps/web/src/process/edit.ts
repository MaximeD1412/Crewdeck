import {
  CATALOGUE,
  defaultStep,
  type ForEach,
  type Phase,
  type ProcessDefinition,
  type RefusalKind,
  type Step,
  type StepKind,
  validateDefinition,
} from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';

/**
 * The canvas's edits of Phases and Étapes (US-93, US-95), pure: each takes
 * the shown definition and gives the next one, or the reason it is refused.
 * What may be done is `validateDefinition`'s answer (ADR 0011): each edit
 * ends on it, its first refusal's label as the reason. The only rules of
 * their own are a free cell and a Phase's name. An edit that changes
 * nothing gives back the same definition.
 */
export type EditResult = { readonly ok: true; readonly definition: ProcessDefinition } | { readonly ok: false; readonly reason: string };

/** Whether an edit would be accepted, and why not: `kind` the refusal's, `null` for a rule of this module. */
export type EditCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly kind: RefusalKind | null };

/** A Phase's grid in reading order: five columns a row. */
const ROW_WIDTH = 5;
const NAME_MAX = 40;

const refuse = (reason: string): EditResult => ({ ok: false, reason });

const checked = (definition: ProcessDefinition): EditCheck => {
  const [refusal] = validateDefinition(definition);
  return refusal ? { ok: false, reason: refusal.label, kind: refusal.kind } : { ok: true };
};

const validated = (definition: ProcessDefinition): EditResult => {
  const check = checked(definition);
  return check.ok ? { ok: true, definition } : refuse(check.reason);
};

const asCheck = (result: EditResult): EditCheck => (result.ok ? { ok: true } : { ok: false, reason: result.reason, kind: null });

/** The first cell of the Phase's grid, in reading order, no Étape but `except` holds. */
const nextFreeCell = (definition: ProcessDefinition, phaseId: string, except: string | null = null): { col: number; row: number } => {
  const taken = new Set(definition.steps.filter((step) => step.phaseId === phaseId && step.id !== except).map((step) => `${step.col}:${step.row}`));
  for (let index = 0; ; index += 1) {
    const cell = { col: (index % ROW_WIDTH) + 1, row: Math.floor(index / ROW_WIDTH) + 1 };
    if (!taken.has(`${cell.col}:${cell.row}`)) return cell;
  }
};

/** The ids of the definition: Phases and Étapes share one namespace. */
const idsOf = (definition: ProcessDefinition): Set<string> => new Set([...definition.phases, ...definition.steps].map((block) => block.id));

/** `st-<kind>`, else `st-<kind>-2`, `-3`…, unique in the definition. */
const stepId = (definition: ProcessDefinition, kind: StepKind): string => {
  const ids = idsOf(definition);
  const base = `st-${kind}`;
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
};

/** Adds an Étape of `kind`, as the catalogue makes it, at the Phase's next free cell; never an Étape du produit. */
export const addStep = (definition: ProcessDefinition, kind: StepKind, phaseId: string): EditResult => {
  const spec = CATALOGUE[kind];
  if (spec.menu === null) return refuse(t('process.edit.coreStep', { name: spec.name }));
  const step = defaultStep(kind, { id: stepId(definition, kind), phaseId, ...nextFreeCell(definition, phaseId) });
  return validated({ ...definition, steps: [...definition.steps, step] });
};

/** The definition without `stepIds`: their arrows, their Retours, and the Commandes no other Étape uses go with them. */
const without = (definition: ProcessDefinition, stepIds: ReadonlySet<string>): ProcessDefinition => {
  const steps = definition.steps.filter((step) => !stepIds.has(step.id));
  const used = new Set(steps.flatMap((step) => step.tools.flatMap((tool) => (tool.kind === 'command' ? [tool.commandId] : []))));
  const removed = new Set(
    definition.steps.filter((step) => stepIds.has(step.id)).flatMap((step) => step.tools.flatMap((tool) => (tool.kind === 'command' ? [tool.commandId] : []))),
  );
  return {
    ...definition,
    steps,
    arrows: definition.arrows.filter((arrow) => !stepIds.has(arrow.from.stepId) && !stepIds.has(arrow.to.stepId)),
    loopBacks: definition.loopBacks.filter((loop) => !stepIds.has(loop.from) && !stepIds.has(loop.to)),
    commands: definition.commands.filter((command) => used.has(command.id) || !removed.has(command.id)),
  };
};

/** Removes an Étape with its arrows, its Retours and the Commandes only it uses. */
export const removeStep = (definition: ProcessDefinition, stepId: string): EditResult => validated(without(definition, new Set([stepId])));

/** Whether `removeStep` would be accepted: the panel's « Retirer » shows its refusal before the click. */
export const canRemoveStep = (definition: ProcessDefinition, stepId: string): EditCheck => checked(without(definition, new Set([stepId])));

const placed = (definition: ProcessDefinition, stepId: string, at: Pick<Step, 'phaseId' | 'col' | 'row'>): ProcessDefinition => ({
  ...definition,
  steps: definition.steps.map((step) => (step.id === stepId ? { ...step, ...at } : step)),
});

/** Moves an Étape to a free cell of a Phase, its arrows kept. */
export const moveStep = (definition: ProcessDefinition, stepId: string, phaseId: string, col: number, row: number): EditResult => {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (step?.phaseId === phaseId && step.col === col && step.row === row) return { ok: true, definition };
  const other = definition.steps.find((candidate) => candidate.id !== stepId && candidate.phaseId === phaseId && candidate.col === col && candidate.row === row);
  if (other) return refuse(t('process.edit.cellTaken', { name: other.name }));
  return validated(placed(definition, stepId, { phaseId, col, row }));
};

/** Moves an Étape to the next free cell of another Phase. */
export const moveStepToPhase = (definition: ProcessDefinition, stepId: string, phaseId: string): EditResult => {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (step?.phaseId === phaseId) return { ok: true, definition };
  return validated(placed(definition, stepId, { phaseId, ...nextFreeCell(definition, phaseId, stepId) }));
};

/** Adds « Nouvelle Phase » (« Nouvelle Phase 2 » when taken), id `ph-<n>`, once, at the first free row under the Phases, column 1. */
export const addPhase = (definition: ProcessDefinition): EditResult => {
  const ids = idsOf(definition);
  let n = 1;
  while (ids.has(`ph-${n}`)) n += 1;
  const names = new Set(definition.phases.map((phase) => phase.name));
  const base = t('process.phase.new');
  let name = base;
  for (let k = 2; names.has(name); k += 1) name = `${base} ${k}`;
  const row = Math.max(0, ...definition.phases.map((phase) => phase.row)) + 1;
  const phase: Phase = { id: `ph-${n}`, name, col: 1, row, forEach: null };
  return validated({ ...definition, phases: [...definition.phases, phase] });
};

const withoutPhase = (definition: ProcessDefinition, phaseId: string): ProcessDefinition => {
  const rest = without(definition, new Set(definition.steps.filter((step) => step.phaseId === phaseId).map((step) => step.id)));
  return { ...rest, phases: rest.phases.filter((phase) => phase.id !== phaseId) };
};

/** Removes a Phase with its Étapes, their arrows and their Retours. */
export const removePhase = (definition: ProcessDefinition, phaseId: string): EditResult => {
  const rest = withoutPhase(definition, phaseId);
  // A Process holds at least one Phase: its schema's rule, said as a Phase removed would leave it.
  if (rest.phases.length === 0) return refuse(t('process.edit.lastPhase'));
  return validated(rest);
};

/** Whether `removePhase` would be accepted: « Retirer la Phase » shows its refusal before the click. */
export const canRemovePhase = (definition: ProcessDefinition, phaseId: string): EditCheck => {
  const rest = withoutPhase(definition, phaseId);
  return rest.phases.length === 0 ? asCheck(refuse(t('process.edit.lastPhase'))) : checked(rest);
};

const sameName = (a: string, b: string): boolean => a.toLocaleLowerCase('fr') === b.toLocaleLowerCase('fr');

/** Renames a Phase: trimmed, 1 to 40 characters, no other Phase's name. */
export const renamePhase = (definition: ProcessDefinition, phaseId: string, name: string): EditResult => {
  const trimmed = name.trim();
  if (trimmed.length === 0) return refuse(t('process.phase.nameRequired'));
  if (trimmed.length > NAME_MAX) return refuse(t('process.phase.nameTooLong', { max: NAME_MAX }));
  const phase = definition.phases.find((candidate) => candidate.id === phaseId);
  if (phase?.name === trimmed) return { ok: true, definition };
  if (definition.phases.some((other) => other.id !== phaseId && sameName(other.name, trimmed))) return refuse(t('process.phase.nameTaken'));
  return validated({ ...definition, phases: definition.phases.map((candidate) => (candidate.id === phaseId ? { ...candidate, name: trimmed } : candidate)) });
};

/** What a Phase repeats for: once (`null`), or each item of a list. */
export const setForEach = (definition: ProcessDefinition, phaseId: string, forEach: ForEach | null): EditResult => {
  const phase = definition.phases.find((candidate) => candidate.id === phaseId);
  if (phase?.forEach === forEach) return { ok: true, definition };
  return validated({ ...definition, phases: definition.phases.map((candidate) => (candidate.id === phaseId ? { ...candidate, forEach } : candidate)) });
};
