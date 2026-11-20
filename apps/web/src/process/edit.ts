import {
  CATALOGUE,
  defaultStep,
  LOOP_BACK_MAX_DEFAULT,
  type Arrow,
  type ForEach,
  type Phase,
  type ProcessDefinition,
  type RefusalKind,
  type Step,
  type StepFamily,
  type StepKind,
  type Tool,
  type ToolKind,
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

/** An arrow's end: a port of an Étape. */
export type PortRef = Arrow['from'];

const sameRef = (a: PortRef, b: PortRef): boolean => a.stepId === b.stepId && a.portId === b.portId;
const isArrow = (arrow: Arrow, from: PortRef, to: PortRef): boolean => sameRef(arrow.from, from) && sameRef(arrow.to, to);

const connected = (definition: ProcessDefinition, from: PortRef, to: PortRef): ProcessDefinition => ({
  ...definition,
  arrows: [...definition.arrows, { from: { stepId: from.stepId, portId: from.portId }, to: { stepId: to.stepId, portId: to.portId } }],
});

/** Draws an arrow from a Sortie to an Entrée (US-94): refused between two types, onto an Entrée already fed, or closing a cycle. */
export const connect = (definition: ProcessDefinition, from: PortRef, to: PortRef): EditResult => validated(connected(definition, from, to));

/** Removes the arrow from `from` to `to`. */
export const disconnect = (definition: ProcessDefinition, from: PortRef, to: PortRef): EditResult => {
  if (!definition.arrows.some((arrow) => isArrow(arrow, from, to))) return { ok: true, definition };
  return validated({ ...definition, arrows: definition.arrows.filter((arrow) => !isArrow(arrow, from, to)) });
};

/** « Alimentée par »: the Sorties `connect` would accept onto `input`, in the definition's order, by running it without applying it. */
export const candidates = (definition: ProcessDefinition, input: PortRef): PortRef[] =>
  definition.steps.flatMap((step) =>
    step.outputs.map((port) => ({ stepId: step.id, portId: port.id })).filter((from) => checked(connected(definition, from, input)).ok),
  );

const LOOP_BACK_MIN = 1;
const LOOP_BACK_MAX = 10;

const loopedBack = (definition: ProcessDefinition, from: string, to: string): ProcessDefinition => ({
  ...definition,
  loopBacks: [...definition.loopBacks, { from, to, max: LOOP_BACK_MAX_DEFAULT }],
});

/** Draws a Retour (US-95), `max` 3: refused from an Étape that does not judge, to another Phase, to one not before it, or a second one. */
export const addLoopBack = (definition: ProcessDefinition, from: string, to: string): EditResult => validated(loopedBack(definition, from, to));

/** The Retour's maximum, 1 to 10. */
export const setLoopBackMax = (definition: ProcessDefinition, from: string, max: number): EditResult => {
  if (!Number.isInteger(max) || max < LOOP_BACK_MIN || max > LOOP_BACK_MAX) return refuse(t('process.loopBack.range', { min: LOOP_BACK_MIN, max: LOOP_BACK_MAX }));
  if (definition.loopBacks.find((loop) => loop.from === from)?.max === max) return { ok: true, definition };
  return validated({ ...definition, loopBacks: definition.loopBacks.map((loop) => (loop.from === from ? { ...loop, max } : loop)) });
};

/** Removes the Retour leaving `from`. */
export const removeLoopBack = (definition: ProcessDefinition, from: string): EditResult => {
  if (!definition.loopBacks.some((loop) => loop.from === from)) return { ok: true, definition };
  return validated({ ...definition, loopBacks: definition.loopBacks.filter((loop) => loop.from !== from) });
};

/** « Poser un Retour vers »: the Étapes `addLoopBack` would accept from `stepId`, in the definition's order. */
export const loopBackTargets = (definition: ProcessDefinition, stepId: string): string[] =>
  definition.steps.filter((step) => step.id !== stepId && checked(loopedBack(definition, stepId, step.id)).ok).map((step) => step.id);

/** An Outil as the Pilote attaches it: a Commande's id is the edit's to give. */
export type AttachedTool = Exclude<Tool, { kind: 'command' }> | { readonly kind: 'command' };

/** What the edit reads of the Projet: its Dépôt GitHub, `null` for a Local Projet. */
export interface ToolContext {
  readonly repository: string | null;
}

/** What each family takes (ADR 0011): an agent its Rôle, Skill, Serveurs MCP and Connecteur; the Checks a Connecteur or Commandes; a Commande Étape Commandes; a gate and the Merge nothing. */
const TAKES: Readonly<Record<StepFamily | 'checks', readonly ToolKind[]>> = {
  agent: ['role', 'skill', 'mcp', 'connector'],
  checks: ['connector', 'command'],
  command: ['command'],
  gate: [],
  core: [],
};

/** Whether an Étape of `kind` takes Outils of `tool`'s kind. */
export const takesTool = (kind: StepKind, tool: ToolKind): boolean => TAKES[kind === 'checks' ? 'checks' : CATALOGUE[kind].family].includes(tool);

/** Whether an Étape of `kind` takes any Outil: « Attacher un Outil » is absent on a gate and on the Merge. */
export const takesTools = (kind: StepKind): boolean => TAKES[kind === 'checks' ? 'checks' : CATALOGUE[kind].family].length > 0;

const TOOLS_MAX = 10;

const sameTool = (a: Tool, b: Tool): boolean => toolKey(a) === toolKey(b);
const toolKey = (tool: Tool): string => {
  switch (tool.kind) {
    case 'role':
      return `role:${tool.roleId}`;
    case 'skill':
      return `skill:${tool.skillId}`;
    case 'mcp':
      return `mcp:${tool.name}`;
    case 'command':
      return `command:${tool.commandId}`;
    case 'connector':
      return `connector:${tool.connector}`;
  }
};

/** `cmd-<n>`, the first free in the definition's Commandes and blocks. */
const commandId = (definition: ProcessDefinition): string => {
  const ids = new Set([...idsOf(definition), ...definition.commands.map((command) => command.id)]);
  let n = 1;
  while (ids.has(`cmd-${n}`)) n += 1;
  return `cmd-${n}`;
};

const withTools = (definition: ProcessDefinition, stepId: string, tools: (step: Step) => Tool[]): ProcessDefinition => ({
  ...definition,
  steps: definition.steps.map((step) => (step.id === stepId ? { ...step, tools: tools(step) } : step)),
});

/**
 * Attaches an Outil to an Étape (US-93, US-73): one Rôle and one Skill (the
 * one attached replaces the other), a Serveur MCP once by name, the
 * Connecteur GitHub for a Projet with a repository, a Commande as a new entry
 * of the definition with its Outil; only what the Étape's family takes, ten
 * at most.
 */
export const attachTool = (definition: ProcessDefinition, stepId: string, tool: AttachedTool, context: ToolContext): EditResult => {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (!step) return validated(definition);
  if (!takesTool(step.kind, tool.kind)) return refuse(t('process.tools.notTaken', { step: step.name, tool: t(`process.tools.kind.${tool.kind}`) }));
  if (tool.kind === 'connector' && context.repository === null) return refuse(t('process.tools.noRepository'));
  const id = tool.kind === 'command' ? commandId(definition) : null;
  const attached: Tool = tool.kind === 'command' ? { kind: 'command', commandId: id! } : tool;
  if (step.tools.some((held) => sameTool(held, attached))) return { ok: true, definition };
  const replaced = attached.kind === 'role' || attached.kind === 'skill';
  const kept = replaced ? step.tools.filter((held) => held.kind !== attached.kind) : step.tools;
  if (kept.length >= TOOLS_MAX) return refuse(t('process.tools.tooMany', { step: step.name, max: TOOLS_MAX }));
  const index = replaced ? step.tools.findIndex((held) => held.kind === attached.kind) : -1;
  const tools = index === -1 ? [...step.tools, attached] : step.tools.map((held, at) => (at === index ? attached : held));
  const next = withTools(definition, stepId, () => tools);
  return validated(id === null ? next : { ...next, commands: [...next.commands, { id }] });
};

/** Detaches an Outil from an Étape; a Commande no other Étape uses leaves the definition with it. */
export const detachTool = (definition: ProcessDefinition, stepId: string, tool: Tool): EditResult => {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (!step?.tools.some((held) => sameTool(held, tool))) return { ok: true, definition };
  const next = withTools(definition, stepId, (held) => held.tools.filter((candidate) => !sameTool(candidate, tool)));
  if (tool.kind !== 'command') return validated(next);
  const used = next.steps.some((other) => other.tools.some((held) => held.kind === 'command' && held.commandId === tool.commandId));
  return validated(used ? next : { ...next, commands: next.commands.filter((command) => command.id !== tool.commandId) });
};
