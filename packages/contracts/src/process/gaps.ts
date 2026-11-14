import { ARTIFACT_TYPE_LABELS, ARTIFACT_TYPES, type ArtifactType } from './artifact-types.js';
import { type Capability, CATALOGUE, type PortSpec, STEP_KINDS, TOOL_CAPABILITIES } from './catalogue.js';
import { type Arrow, FOR_EACH, type Phase, type Port, type ProcessDefinition, type Step } from './definition.js';
import { type ProcessSources, TYPE_SOURCE } from './sources.js';

/**
 * The canvas's rules (ADR 0011, « Manques »), pure and synchronous, run by
 * the page and the server alike. `validateDefinition` gives what is never
 * drawable: a definition with a refusal is never saved. `findGaps` gives the
 * Manques of a definition it accepts: they are saved in the draft and only
 * forbid activation. Each result names its block by a dotted path
 * (`steps.st-merge.inputs.v-review`, `arrows.3`) and carries its French
 * label, built here as the Contrats' are, so that the canvas, the server's
 * 422 and the phone show the same sentence.
 */

export const REFUSAL_KINDS = [
  'id.duplicate',
  'ref.unknown',
  'position.taken',
  'for-each.duplicate',
  'step.ports',
  'step.tools',
  'arrow.direction',
  'arrow.type-mismatch',
  'arrow.cycle',
  'input.many-arrows',
  'loop-back.not-judging',
  'loop-back.other-phase',
  'loop-back.not-before',
  'loop-back.many',
  'core.missing',
  'core.duplicate',
] as const;
export type RefusalKind = (typeof REFUSAL_KINDS)[number];

export const GAP_KINDS = ['input.unfed', 'source.missing', 'capability.missing', 'merge.no-review', 'merge.no-checks'] as const;
export type ProcessGapKind = (typeof GAP_KINDS)[number];

export interface Refusal {
  readonly kind: RefusalKind;
  readonly target: string;
  readonly label: string;
}

export interface ProcessGap {
  readonly kind: ProcessGapKind;
  readonly target: string;
  readonly label: string;
}

const CORE_MISSING = '« Checks », « Merge » et une Review sont dans chaque Process : ils ne se retirent pas';
const ARROW_CYCLE = 'Cette flèche ferait une boucle : une boucle n’existe que comme Retour, avec son maximum.';

/** What the canvas shows of a port: its type, then its note (« Verdict de la Review »). */
const portLabel = (port: Port): string => (port.note === undefined ? ARTIFACT_TYPE_LABELS[port.type] : `${ARTIFACT_TYPE_LABELS[port.type]} ${port.note}`);

const stepTarget = (step: Step): string => `steps.${step.id}`;
const inputTarget = (step: Step, portId: string): string => `steps.${step.id}.inputs.${portId}`;
const outputTarget = (step: Step, portId: string): string => `steps.${step.id}.outputs.${portId}`;

const firstById = <T extends { id: string }>(blocks: readonly T[]): Map<string, T> => {
  const byId = new Map<string, T>();
  for (const block of blocks) if (!byId.has(block.id)) byId.set(block.id, block);
  return byId;
};

/** The Étapes one arrow away from each Étape, whatever the ports. */
type Graph = Map<string, Set<string>>;
const link = (graph: Graph, from: string, to: string): void => {
  const next = graph.get(from) ?? new Set<string>();
  next.add(to);
  graph.set(from, next);
};
const reaches = (graph: Graph, from: string, to: string, keep: (stepId: string) => boolean = () => true): boolean => {
  const seen = new Set<string>();
  const queue = [from];
  for (const current of queue) {
    for (const next of graph.get(current) ?? []) {
      if (next === to) return true;
      if (!seen.has(next) && keep(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
};

interface Placed {
  readonly name: string;
  readonly col: number;
  readonly row: number;
}

/** The cells of one grid: what it returns gives the refusal of a block put on a cell another already holds (in `scope`, a Phase). */
const grid = () => {
  const cells = new Map<string, Placed>();
  return (block: Placed, target: string, scope = ''): Refusal[] => {
    const cell = `${scope}:${block.col}:${block.row}`;
    const other = cells.get(cell);
    if (other === undefined) {
      cells.set(cell, block);
      return [];
    }
    return [{ kind: 'position.taken', target, label: `« ${block.name} » est sur la case de « ${other.name} »` }];
  };
};

const forEachRefusals = (phases: readonly Phase[]): Refusal[] => {
  const refusals: Refusal[] = [];
  const forEach = new Map<string, Phase>();
  for (const phase of phases) {
    if (phase.forEach === null) continue;
    const other = forEach.get(phase.forEach);
    if (other === undefined) forEach.set(phase.forEach, phase);
    else
      refusals.push({
        kind: 'for-each.duplicate',
        target: `phases.${phase.id}`,
        label: `« ${phase.name} » se répète pour ${FOR_EACH[phase.forEach].label}, comme « ${other.name} »`,
      });
  }
  return refusals;
};

/** Ports of one side sharing an id. */
const duplicatePorts = (step: Step, side: 'inputs' | 'outputs'): Refusal[] => {
  const seen = new Set<string>();
  const refusals: Refusal[] = [];
  for (const port of step[side]) {
    if (!seen.has(port.id)) seen.add(port.id);
    else
      refusals.push({
        kind: 'id.duplicate',
        target: side === 'inputs' ? inputTarget(step, port.id) : outputTarget(step, port.id),
        label: `« ${step.name} » a deux ${side === 'inputs' ? 'Entrées' : 'Sorties'} « ${port.id} »`,
      });
  }
  return refusals;
};

/** The ports the step's kind allows: its default ports with their types, the extra Entrées, no other Sortie. */
const portRefusals = (step: Step): Refusal[] => {
  const spec = CATALOGUE[step.kind];
  const refusals: Refusal[] = [];
  const allows = (portSpec: PortSpec | undefined, port: Port): boolean => {
    if (portSpec === undefined) return false;
    if (portSpec.sameTypeAs !== undefined) return step.inputs.find((input) => input.id === portSpec.sameTypeAs)?.type === port.type;
    return portSpec.types.includes(port.type);
  };
  for (const portSpec of spec.inputs)
    if (!step.inputs.some((port) => port.id === portSpec.id))
      refusals.push({ kind: 'step.ports', target: inputTarget(step, portSpec.id), label: `« ${step.name} » n’a plus son Entrée « ${portSpec.id} »` });
  for (const portSpec of spec.outputs)
    if (!step.outputs.some((port) => port.id === portSpec.id))
      refusals.push({ kind: 'step.ports', target: outputTarget(step, portSpec.id), label: `« ${step.name} » n’a plus sa Sortie « ${portSpec.id} »` });
  for (const port of step.inputs) {
    const portSpec = spec.inputs.find((candidate) => candidate.id === port.id);
    const allowed = portSpec === undefined ? spec.extraInputs.includes(port.type) : allows(portSpec, port);
    if (!allowed)
      refusals.push({ kind: 'step.ports', target: inputTarget(step, port.id), label: `« ${step.name} » ne prend pas d’Entrée ${ARTIFACT_TYPE_LABELS[port.type]}` });
  }
  for (const port of step.outputs) {
    const portSpec = spec.outputs.find((candidate) => candidate.id === port.id);
    if (allows(portSpec, port)) continue;
    const source = portSpec?.sameTypeAs === undefined ? undefined : step.inputs.find((input) => input.id === portSpec.sameTypeAs);
    refusals.push({
      kind: 'step.ports',
      target: outputTarget(step, port.id),
      label:
        source === undefined
          ? `« ${step.name} » ne donne pas de Sortie ${ARTIFACT_TYPE_LABELS[port.type]}`
          : `« ${step.name} » rend son Entrée « ${source.id} » : sa Sortie « ${port.id} » prend le type ${ARTIFACT_TYPE_LABELS[source.type]}`,
    });
  }
  return refusals;
};

/** A Rôle and a Skill are an agent's, one of each. */
const toolRefusals = (step: Step, commandIds: ReadonlySet<string>): Refusal[] => {
  const refusals: Refusal[] = [];
  const count = (kind: 'role' | 'skill') => step.tools.filter((tool) => tool.kind === kind).length;
  if (CATALOGUE[step.kind].family !== 'agent') {
    if (count('role') + count('skill') > 0)
      refusals.push({ kind: 'step.tools', target: stepTarget(step), label: `« ${step.name} » n’est pas l’Étape d’un agent : ni Rôle ni Skill` });
  } else {
    if (count('role') > 1) refusals.push({ kind: 'step.tools', target: stepTarget(step), label: `« ${step.name} » a deux Rôles : un seul par Étape` });
    if (count('skill') > 1) refusals.push({ kind: 'step.tools', target: stepTarget(step), label: `« ${step.name} » a deux Skills : un seul par Étape` });
  }
  for (const tool of step.tools)
    if (tool.kind === 'command' && !commandIds.has(tool.commandId))
      refusals.push({ kind: 'ref.unknown', target: stepTarget(step), label: `« ${step.name} » lance une Commande qui n’existe pas : « ${tool.commandId} »` });
  return refusals;
};

type End = { step: Step; port: Port } | Refusal;

const SIDES = {
  from: { verb: 'part d’une', own: 'Sortie', ports: 'outputs', other: 'inputs' },
  to: { verb: 'va vers une', own: 'Entrée', ports: 'inputs', other: 'outputs' },
} as const;

/** An arrow's end: the port it names on its side, else the refusal of what it names. */
const resolveEnd = (steps: ReadonlyMap<string, Step>, ref: Arrow['from'], side: keyof typeof SIDES, target: string): End => {
  const { verb, own, ports, other } = SIDES[side];
  const step = steps.get(ref.stepId);
  if (step === undefined) return { kind: 'ref.unknown', target, label: `Cette flèche ${verb} Étape qui n’existe pas : « ${ref.stepId} »` };
  const port = step[ports].find((candidate) => candidate.id === ref.portId);
  if (port !== undefined) return { step, port };
  if (step[other].some((candidate) => candidate.id === ref.portId)) return { kind: 'arrow.direction', target, label: 'Une flèche va d’une Sortie vers une Entrée' };
  return { kind: 'ref.unknown', target, label: `Cette flèche ${verb} ${own} que « ${step.name} » n’a pas : « ${ref.portId} »` };
};

/** The arrows in order, each against the ones accepted before it; the accepted ones form the graph the Retours are checked on. */
const arrowRefusals = (definition: ProcessDefinition, steps: ReadonlyMap<string, Step>, graph: Graph): Refusal[] => {
  const refusals: Refusal[] = [];
  const fed = new Set<string>();
  definition.arrows.forEach((arrow, index) => {
    const target = `arrows.${index}`;
    const from = resolveEnd(steps, arrow.from, 'from', target);
    if ('kind' in from) return void refusals.push(from);
    const to = resolveEnd(steps, arrow.to, 'to', target);
    if ('kind' in to) return void refusals.push(to);
    const type = ARTIFACT_TYPE_LABELS[from.port.type];
    if (from.port.type !== to.port.type) return void refusals.push({ kind: 'arrow.type-mismatch', target, label: `Une Sortie ${type} ne va que vers une Entrée ${type}` });
    const entry = `${to.step.id}.${to.port.id}`;
    if (fed.has(entry))
      return void refusals.push({ kind: 'input.many-arrows', target, label: `L’Entrée « ${portLabel(to.port)} » de « ${to.step.name} » a déjà sa flèche` });
    if (from.step.id === to.step.id || reaches(graph, to.step.id, from.step.id)) return void refusals.push({ kind: 'arrow.cycle', target, label: ARROW_CYCLE });
    fed.add(entry);
    link(graph, from.step.id, to.step.id);
  });
  return refusals;
};

/** A Retour leaves an Étape that judges, once, for one that leads to it by arrows inside their Phase. */
const loopBackRefusals = (definition: ProcessDefinition, steps: ReadonlyMap<string, Step>, phases: ReadonlyMap<string, Phase>, graph: Graph): Refusal[] => {
  const refusals: Refusal[] = [];
  const leaving = new Set<string>();
  definition.loopBacks.forEach((loopBack, index) => {
    const target = `loopBacks.${index}`;
    const from = steps.get(loopBack.from);
    const to = steps.get(loopBack.to);
    if (from === undefined) return void refusals.push({ kind: 'ref.unknown', target, label: `Ce Retour part d’une Étape qui n’existe pas : « ${loopBack.from} »` });
    if (to === undefined) return void refusals.push({ kind: 'ref.unknown', target, label: `Ce Retour va vers une Étape qui n’existe pas : « ${loopBack.to} »` });
    if (!CATALOGUE[from.kind].judges)
      return void refusals.push({ kind: 'loop-back.not-judging', target, label: `« ${from.name} » ne juge pas : un Retour part d’une Étape qui juge` });
    if (to.phaseId !== from.phaseId) {
      const phase = phases.get(from.phaseId)?.name ?? from.phaseId;
      return void refusals.push({ kind: 'loop-back.other-phase', target, label: `Un Retour reste dans sa Phase : « ${to.name} » n’est pas dans « ${phase} »` });
    }
    const inPhase = (stepId: string) => steps.get(stepId)?.phaseId === from.phaseId;
    if (to.id === from.id || !reaches(graph, to.id, from.id, inPhase))
      return void refusals.push({ kind: 'loop-back.not-before', target, label: `Un Retour revient en arrière : « ${to.name} » ne vient pas avant « ${from.name} »` });
    if (leaving.has(from.id)) return void refusals.push({ kind: 'loop-back.many', target, label: `« ${from.name} » a déjà son Retour` });
    leaving.add(from.id);
  });
  return refusals;
};

/** The kinds a Process always holds: the Étapes du produit and the Review, which are never removed. */
const REQUIRED_KINDS = STEP_KINDS.filter((kind) => CATALOGUE[kind].removable !== 'yes');

/**
 * What the canvas never draws, in the order of the blocks: the Phases, the
 * Étapes, the arrows, the Retours, then what the definition lacks. Empty
 * when the definition may be saved.
 */
export const validateDefinition = (definition: ProcessDefinition): Refusal[] => {
  const refusals: Refusal[] = [];
  const phases = firstById(definition.phases);
  const steps = firstById(definition.steps);
  const commandIds = new Set(definition.commands.map((command) => command.id));

  const ids = new Map<string, string>();
  const claim = (block: { id: string; name: string }, target: string) => {
    const other = ids.get(block.id);
    if (other === undefined) ids.set(block.id, block.name);
    else refusals.push({ kind: 'id.duplicate', target, label: `« ${block.name} » reprend l’identifiant « ${block.id} » de « ${other} »` });
  };

  const phaseCells = grid();
  for (const phase of definition.phases) {
    claim(phase, `phases.${phase.id}`);
    refusals.push(...phaseCells(phase, `phases.${phase.id}`));
  }
  refusals.push(...forEachRefusals(definition.phases));

  const kinds = new Map<string, Step>();
  const stepCells = grid();
  for (const step of definition.steps) {
    claim(step, stepTarget(step));
    if (!phases.has(step.phaseId))
      refusals.push({ kind: 'ref.unknown', target: stepTarget(step), label: `« ${step.name} » est dans une Phase qui n’existe pas : « ${step.phaseId} »` });
    else refusals.push(...stepCells(step, stepTarget(step), step.phaseId));
    refusals.push(...duplicatePorts(step, 'inputs'), ...duplicatePorts(step, 'outputs'), ...portRefusals(step), ...toolRefusals(step, commandIds));
    if (CATALOGUE[step.kind].unique && kinds.has(step.kind))
      refusals.push({ kind: 'core.duplicate', target: stepTarget(step), label: `Un Process n’a qu’une Étape « ${CATALOGUE[step.kind].name} »` });
    if (!kinds.has(step.kind)) kinds.set(step.kind, step);
  }

  const graph: Graph = new Map();
  refusals.push(...arrowRefusals(definition, steps, graph), ...loopBackRefusals(definition, steps, phases, graph));

  if (REQUIRED_KINDS.some((kind) => !kinds.has(kind))) refusals.push({ kind: 'core.missing', target: 'steps', label: CORE_MISSING });
  return refusals;
};

const NEEDS: Readonly<Record<Capability, string>> = { agent: 'd’un Rôle', command: 'd’une Commande', ci: 'de la CI du dépôt' };

/** The capabilities an Étape's Outils give: the Connecteur's CI only when the code's Source is GitHub. */
const capabilitiesOf = (step: Step, sources: ProcessSources): Set<Capability> =>
  new Set(
    step.tools.flatMap((tool) => TOOL_CAPABILITIES[tool.kind]).filter((capability) => capability !== 'ci' || sources.code === 'github'),
  );

/** Whether a Sortie of type `type` of an Étape of `kind` leads, by arrows through any Étapes, to an Entrée of `merge`. */
const reachesMerge = (definition: ProcessDefinition, graph: Graph, merge: Step, kind: Step['kind'], type: ArtifactType): boolean =>
  definition.steps
    .filter((step) => step.kind === kind)
    .some((step) =>
      definition.arrows.some(
        (arrow) =>
          arrow.from.stepId === step.id &&
          step.outputs.some((port) => port.id === arrow.from.portId && port.type === type) &&
          (arrow.to.stepId === merge.id || reaches(graph, arrow.to.stepId, merge.id)),
      ),
    );

/**
 * The Manques of a definition `validateDefinition` accepts, in the order of
 * its Étapes (each one's Entrées, its capabilities, then the Merge's
 * guards), then the Sources the types it passes lack, in the order of the
 * Types d'artefact. Empty when it may be activated.
 */
export const findGaps = (definition: ProcessDefinition, sources: ProcessSources): ProcessGap[] => {
  const gaps: ProcessGap[] = [];
  const phases = firstById(definition.phases);
  const fed = new Set(definition.arrows.map((arrow) => `${arrow.to.stepId}.${arrow.to.portId}`));
  const graph: Graph = new Map();
  for (const arrow of definition.arrows) link(graph, arrow.from.stepId, arrow.to.stepId);

  for (const step of definition.steps) {
    const forEach = phases.get(step.phaseId)?.forEach ?? null;
    const item = forEach === null ? null : FOR_EACH[forEach].type;
    for (const port of step.inputs)
      if (!fed.has(`${step.id}.${port.id}`) && port.type !== item)
        gaps.push({ kind: 'input.unfed', target: inputTarget(step, port.id), label: `Entrée « ${portLabel(port)} » de « ${step.name} » : rien ne l’alimente` });

    const { needs } = CATALOGUE[step.kind];
    const given = capabilitiesOf(step, sources);
    if (needs.length > 0 && !needs.some((capability) => given.has(capability)))
      gaps.push({
        kind: 'capability.missing',
        target: stepTarget(step),
        label: `« ${step.name} » a besoin ${needs.map((capability) => NEEDS[capability]).join(' ou ')} : aucun Outil attaché n’en donne`,
      });

    if (step.kind === 'merge') {
      if (!reachesMerge(definition, graph, step, 'review', 'verdict'))
        gaps.push({ kind: 'merge.no-review', target: stepTarget(step), label: `« ${step.name} » merge un Changement de code sans Review avant lui` });
      if (!reachesMerge(definition, graph, step, 'checks', 'verdict'))
        gaps.push({ kind: 'merge.no-checks', target: stepTarget(step), label: `« ${step.name} » merge un Changement de code sans checks avant lui` });
    }
  }

  const passed = new Set(definition.steps.flatMap((step) => [...step.inputs, ...step.outputs].map((port) => port.type)));
  for (const type of ARTIFACT_TYPES) {
    const group = TYPE_SOURCE[type];
    if (passed.has(type) && (group === 'ticket' || group === 'code') && sources[group] === null)
      gaps.push({ kind: 'source.missing', target: `sources.${type}`, label: `${ARTIFACT_TYPE_LABELS[type]} : aucune Source` });
  }
  return gaps;
};
