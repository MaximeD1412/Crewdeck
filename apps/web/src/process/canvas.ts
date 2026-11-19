import { CATALOGUE, type Phase, type Port, type ProcessDefinition, type ProcessGap, type Step, type Tool } from '@crewdeck/contracts';
import { t, type ComposantData, type ProcessCanvas } from '@crewdeck/sdk';

export type CanvasData = ComposantData<typeof ProcessCanvas>;
type CanvasStep = CanvasData['phases'][number]['steps'][number];
type CanvasPort = CanvasStep['ports'][number];
type CanvasTool = CanvasStep['tools'][number];

/** What the page has selected: an Étape, a Phase, or the Sources (`id` `null`, or the Type d'artefact a Manque names). */
export interface Selection {
  readonly kind: 'step' | 'phase' | 'sources';
  readonly id: string | null;
}

/** What the canvas reads beside the definition: the page's view, the Pilote's Rôles' names, the block to centre. */
export interface CanvasContext {
  readonly zoom: number;
  readonly pan: { readonly x: number; readonly y: number };
  /** The Pilote's own Rôles' names, by id (`settings.customRoles`). */
  readonly roleNames: Readonly<Record<string, string>>;
  readonly focus: { readonly id: string; readonly at: number } | null;
}

/** The Étape and, for an Entrée, the port a Manque's `target` points at (`steps.<id>`, `steps.<id>.inputs.<port>`). */
export const gapStep = (gap: Pick<ProcessGap, 'target'>): { stepId: string; inputId: string | null } | null => {
  const [root, stepId, side, portId] = gap.target.split('.');
  if (root !== 'steps' || !stepId) return null;
  return { stepId, inputId: side === 'inputs' && portId ? portId : null };
};

/** The name of a Rôle: a default one's from the catalogue of the page, the Pilote's own by its name. */
export const roleName = (roleId: string, roleNames: Readonly<Record<string, string>>): string => {
  if (roleId === 'idea' || roleId === 'design' || roleId === 'code' || roleId === 'review') return t(`role.${roleId}`);
  return Object.hasOwn(roleNames, roleId) ? (roleNames[roleId] ?? roleId) : roleId;
};

/** What the card says under an Étape's name: its family, or its kind's own words. */
export const kindLabelOf = (step: Step, phase: Phase | undefined): string => {
  if (step.kind === 'cross-review') return t('process.kind.crossReview');
  if (step.kind === 'checks') return t(step.tools.some((tool) => tool.kind === 'connector') ? 'process.kind.checks.ci' : 'process.kind.checks.commands');
  if (step.kind === 'merge' && phase?.forEach === 'ticket.ready') return t('process.kind.merge.loop');
  return t(`process.kind.${CATALOGUE[step.kind].family}`);
};

/** A port's Type d'artefact, as the canvas and the panel name it. */
export const typeLabel = (type: Port['type']): string => t(`process.type.${type}`);

const toolChip = (tool: Tool, roleNames: Readonly<Record<string, string>>): CanvasTool => {
  switch (tool.kind) {
    case 'role':
      return { kind: 'role', label: roleName(tool.roleId, roleNames) };
    case 'skill':
      return { kind: 'skill', label: tool.skillId };
    case 'mcp':
      return { kind: 'mcp', label: tool.name };
    case 'command':
      // Its text is in the sealed part, PROCESS-12's to open.
      return { kind: 'command', label: t('process.tool.command') };
    case 'connector':
      return { kind: 'connector', label: t('process.tool.connector.github') };
  }
};

const portOf = (port: Port, dir: 'in' | 'out', unfed: boolean): CanvasPort => ({
  id: port.id,
  dir,
  type: port.type,
  label: typeLabel(port.type),
  note: port.note ?? null,
  state: unfed ? 'unfed' : null,
});

/**
 * The canvas of a definition (pure, US-92), read only: its Phases at their
 * cells, each with its « pour chaque » and its count of Manques, their Étapes
 * at their cells with their family, their ports by Type d'artefact (an
 * Entrée a Manque names `unfed`) and their Outils; the arrows and Retours as
 * defined; the selected block marked.
 */
export const canvasOf = (definition: ProcessDefinition, gaps: readonly ProcessGap[], selection: Selection | null, context: CanvasContext): CanvasData => {
  const gapsByStep = new Map<string, number>();
  const unfed = new Set<string>();
  for (const gap of gaps) {
    const at = gapStep(gap);
    if (!at) continue;
    gapsByStep.set(at.stepId, (gapsByStep.get(at.stepId) ?? 0) + 1);
    if (gap.kind === 'input.unfed' && at.inputId) unfed.add(`${at.stepId}.${at.inputId}`);
  }
  const selected = (kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id;

  const stepOf = (step: Step, phase: Phase): CanvasStep => ({
    id: step.id,
    name: step.name,
    kindLabel: kindLabelOf(step, phase),
    variant: CATALOGUE[step.kind].family,
    selected: selected('step', step.id),
    gaps: gapsByStep.get(step.id) ?? 0,
    judges: CATALOGUE[step.kind].judges,
    col: step.col,
    row: step.row,
    ports: [
      ...step.inputs.map((port) => portOf(port, 'in', unfed.has(`${step.id}.${port.id}`))),
      ...step.outputs.map((port) => portOf(port, 'out', false)),
    ],
    tools: step.tools.map((tool) => toolChip(tool, context.roleNames)),
  });

  return {
    editable: false,
    zoom: context.zoom,
    pan: { x: context.pan.x, y: context.pan.y },
    focus: context.focus ? { id: context.focus.id, at: context.focus.at } : null,
    phases: definition.phases.map((phase) => {
      const steps = definition.steps.filter((step) => step.phaseId === phase.id).map((step) => stepOf(step, phase));
      return {
        id: phase.id,
        name: phase.name,
        forEach: phase.forEach === null ? null : t(`process.forEach.${phase.forEach}`),
        gaps: steps.reduce((sum, step) => sum + step.gaps, 0),
        target: false,
        selected: selected('phase', phase.id),
        col: phase.col,
        row: phase.row,
        steps,
      };
    }),
    arrows: definition.arrows.map((arrow) => ({
      from: { stepId: arrow.from.stepId, portId: arrow.from.portId },
      to: { stepId: arrow.to.stepId, portId: arrow.to.portId },
      state: null,
    })),
    loopBacks: definition.loopBacks.map((loop) => ({ from: loop.from, to: loop.to, max: loop.max, state: null })),
  };
};
