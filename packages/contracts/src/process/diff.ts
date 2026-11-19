import type { Arrow, ForEach, LoopBack, Phase, ProcessDefinition, Step, Tool } from './definition.js';

/**
 * What changed from one definition to another (ADR 0011, « Drafts,
 * activation, Modèles »): the list the activation's confirmation shows, and
 * the server's refusal of a draft that changes nothing. Ids match across
 * versions, so a renamed Phase is one change. It reads what
 * `validateDefinition` accepts (unique ids), as `findGaps` does. A change inside a block added
 * or removed is that block's: a Phase's Étapes, an Étape's arrows, Retours
 * and Outils are not listed again. Every move of a cell inside its Phase, or
 * of a Phase, is the one `layout.changed`. A Commande's text is in the
 * sealed part, which this function does not read (PROCESS-12).
 */

export const PROCESS_CHANGE_KINDS = [
  'phase.added',
  'phase.removed',
  'phase.renamed',
  'phase.for-each-changed',
  'step.added',
  'step.removed',
  'step.moved',
  'tool.attached',
  'tool.detached',
  'arrow.added',
  'arrow.removed',
  'loop-back.added',
  'loop-back.removed',
  'loop-back.max-changed',
  'layout.changed',
] as const;
export type ProcessChangeKind = (typeof PROCESS_CHANGE_KINDS)[number];

/** A block named as the change shows it: its id, and its name in the definition that has it (the new one when both do). */
export interface ProcessRef {
  readonly id: string;
  readonly name: string;
}

/** An end of an arrow: its Étape, its port, and its Étape's name. */
export interface ArrowEnd {
  readonly stepId: string;
  readonly portId: string;
  readonly name: string;
}

export type ProcessChange =
  | { readonly kind: 'phase.added' | 'phase.removed'; readonly phase: ProcessRef }
  | { readonly kind: 'phase.renamed'; readonly phaseId: string; readonly from: string; readonly to: string }
  | { readonly kind: 'phase.for-each-changed'; readonly phase: ProcessRef; readonly from: ForEach | null; readonly to: ForEach | null }
  | { readonly kind: 'step.added' | 'step.removed'; readonly step: ProcessRef; readonly phase: ProcessRef }
  | { readonly kind: 'step.moved'; readonly step: ProcessRef; readonly from: ProcessRef; readonly to: ProcessRef }
  | { readonly kind: 'arrow.added' | 'arrow.removed'; readonly from: ArrowEnd; readonly to: ArrowEnd }
  | { readonly kind: 'loop-back.added' | 'loop-back.removed'; readonly from: ProcessRef; readonly to: ProcessRef; readonly max: number }
  | { readonly kind: 'loop-back.max-changed'; readonly from: ProcessRef; readonly to: ProcessRef; readonly before: number; readonly after: number }
  | { readonly kind: 'tool.attached' | 'tool.detached'; readonly step: ProcessRef; readonly tool: Tool }
  | { readonly kind: 'layout.changed' };

const byId = <T extends { id: string }>(items: readonly T[]): Map<string, T> => new Map(items.map((item) => [item.id, item]));
const ref = (block: Phase | Step): ProcessRef => ({ id: block.id, name: block.name });

const arrowKey = (arrow: Arrow): string => `${arrow.from.stepId}.${arrow.from.portId}>${arrow.to.stepId}.${arrow.to.portId}`;
const loopBackKey = (loopBack: LoopBack): string => `${loopBack.from}>${loopBack.to}`;
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

const order = (change: ProcessChange): number => PROCESS_CHANGE_KINDS.indexOf(change.kind);

/** The changes from `from` to `to` (pure), in the order of `PROCESS_CHANGE_KINDS`; nothing for two equal definitions. */
export const diffDefinitions = (from: ProcessDefinition, to: ProcessDefinition): ProcessChange[] => {
  const changes: ProcessChange[] = [];
  const phasesBefore = byId(from.phases);
  const phasesAfter = byId(to.phases);
  const stepsBefore = byId(from.steps);
  const stepsAfter = byId(to.steps);
  let layout = false;

  for (const phase of to.phases) {
    const before = phasesBefore.get(phase.id);
    if (!before) {
      changes.push({ kind: 'phase.added', phase: ref(phase) });
      continue;
    }
    if (before.name !== phase.name) changes.push({ kind: 'phase.renamed', phaseId: phase.id, from: before.name, to: phase.name });
    if (before.forEach !== phase.forEach) changes.push({ kind: 'phase.for-each-changed', phase: ref(phase), from: before.forEach, to: phase.forEach });
    if (before.col !== phase.col || before.row !== phase.row) layout = true;
  }
  for (const phase of from.phases) if (!phasesAfter.has(phase.id)) changes.push({ kind: 'phase.removed', phase: ref(phase) });

  for (const step of to.steps) {
    const before = stepsBefore.get(step.id);
    const phase = phasesAfter.get(step.phaseId);
    if (!before) {
      // An Étape of a new Phase is that Phase's change.
      if (phase && phasesBefore.has(phase.id)) changes.push({ kind: 'step.added', step: ref(step), phase: ref(phase) });
      continue;
    }
    if (before.phaseId !== step.phaseId) {
      const left = phasesBefore.get(before.phaseId);
      if (left && phase) changes.push({ kind: 'step.moved', step: ref(step), from: ref(phasesAfter.get(left.id) ?? left), to: ref(phase) });
    } else if (before.col !== step.col || before.row !== step.row) layout = true;

    const toolsBefore = new Set(before.tools.map(toolKey));
    const toolsAfter = new Set(step.tools.map(toolKey));
    for (const tool of step.tools) if (!toolsBefore.has(toolKey(tool))) changes.push({ kind: 'tool.attached', step: ref(step), tool });
    for (const tool of before.tools) if (!toolsAfter.has(toolKey(tool))) changes.push({ kind: 'tool.detached', step: ref(step), tool });
  }
  for (const step of from.steps) {
    if (stepsAfter.has(step.id) || !phasesAfter.has(step.phaseId)) continue;
    changes.push({ kind: 'step.removed', step: ref(step), phase: ref(phasesAfter.get(step.phaseId) ?? phasesBefore.get(step.phaseId)!) });
  }

  // An arrow or a Retour is listed only between Étapes both definitions have: else its Étape's change says it.
  const kept = (stepId: string): boolean => stepsBefore.has(stepId) && stepsAfter.has(stepId);
  const end = (steps: Map<string, Step>, at: Arrow['from']): ArrowEnd => ({ stepId: at.stepId, portId: at.portId, name: steps.get(at.stepId)?.name ?? at.stepId });
  const arrowsBefore = new Set(from.arrows.map(arrowKey));
  const arrowsAfter = new Set(to.arrows.map(arrowKey));
  for (const arrow of to.arrows) {
    if (arrowsBefore.has(arrowKey(arrow)) || !kept(arrow.from.stepId) || !kept(arrow.to.stepId)) continue;
    changes.push({ kind: 'arrow.added', from: end(stepsAfter, arrow.from), to: end(stepsAfter, arrow.to) });
  }
  for (const arrow of from.arrows) {
    if (arrowsAfter.has(arrowKey(arrow)) || !kept(arrow.from.stepId) || !kept(arrow.to.stepId)) continue;
    changes.push({ kind: 'arrow.removed', from: end(stepsAfter, arrow.from), to: end(stepsAfter, arrow.to) });
  }

  const stepRef = (id: string): ProcessRef => ref(stepsAfter.get(id) ?? stepsBefore.get(id)!);
  const loopBacksBefore = new Map(from.loopBacks.map((loopBack) => [loopBackKey(loopBack), loopBack]));
  const loopBacksAfter = new Map(to.loopBacks.map((loopBack) => [loopBackKey(loopBack), loopBack]));
  for (const loopBack of to.loopBacks) {
    if (!kept(loopBack.from) || !kept(loopBack.to)) continue;
    const before = loopBacksBefore.get(loopBackKey(loopBack));
    if (!before) changes.push({ kind: 'loop-back.added', from: stepRef(loopBack.from), to: stepRef(loopBack.to), max: loopBack.max });
    else if (before.max !== loopBack.max) {
      changes.push({ kind: 'loop-back.max-changed', from: stepRef(loopBack.from), to: stepRef(loopBack.to), before: before.max, after: loopBack.max });
    }
  }
  for (const loopBack of from.loopBacks) {
    if (loopBacksAfter.has(loopBackKey(loopBack)) || !kept(loopBack.from) || !kept(loopBack.to)) continue;
    changes.push({ kind: 'loop-back.removed', from: stepRef(loopBack.from), to: stepRef(loopBack.to), max: loopBack.max });
  }

  if (layout) changes.push({ kind: 'layout.changed' });
  // Stable: within a kind, the order the definitions give.
  return changes.sort((a, b) => order(a) - order(b));
};
