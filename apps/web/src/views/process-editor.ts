import {
  ARTIFACT_TYPES,
  FOR_EACH,
  findGaps,
  processSourcesOf,
  TYPE_SOURCE,
  withDefaultRoles,
  type AccountSettings,
  type AiAccount,
  type ArtifactType,
  type Port,
  type ProcessDefinition,
  type ProcessGap,
  type Project,
  type ProjectProcess,
  type ProjectSource,
  type Runner,
  type Step,
  type Tool,
  type ForEach,
} from '@crewdeck/contracts';
import { formatDate, t, type ComposantData, type MessageKey, type PageProcessEditor } from '@crewdeck/sdk';
import { canvasOf, gapStep, kindLabelOf, roleName, targetPhaseOf, typeLabel, type Selection } from '../process/canvas.js';
import { catalogueMenu } from '../process/catalogue-menu.js';
import { canRemovePhase, canRemoveStep } from '../process/edit.js';
import type { EditorUi } from '../process/editor-ui.js';

export type ProcessEditorData = ComposantData<typeof PageProcessEditor>;
type GapRow = ProcessEditorData['gaps'][number];
type ToolRow = NonNullable<ProcessEditorData['step']>['tools'][number];
type SourceRow = ProcessEditorData['sources']['rows'][number];

/** What « Gestion du process » reads of the store. */
export interface ProcessEditorState {
  readonly slices: {
    readonly project?: ReadonlyMap<string, Project>;
    readonly process?: ReadonlyMap<string, ProjectProcess>;
    readonly settings?: AccountSettings | null;
    readonly runner?: Pick<Runner, 'machine'> | null;
    readonly 'ai-account'?: { values(): Iterable<AiAccount> };
  };
}

/** What the page's edits add to the store's view (PROCESS-8): `NO_EDITS` reads the store as is. */
export interface EditorEdits {
  /** The Process as the canvas shows it, its edits not saved yet included; `undefined`: the store's. */
  readonly shown?: ProjectProcess | undefined;
  /** Whether the catalogue's Menu is open. */
  readonly catalogue: boolean;
  /** The Phase whose removal the Dialog asks. */
  readonly removingPhase: string | null;
  /** The last refusal, in a halt Toast. */
  readonly toast: string | null;
  /** Why a Phase's name was refused. */
  readonly nameError: { readonly phaseId: string; readonly text: string } | null;
  /** The last ask to focus a Phase's name. */
  readonly focusName: { readonly phaseId: string; readonly at: number } | null;
}

export const NO_EDITS: EditorEdits = { catalogue: false, removingPhase: null, toast: null, nameError: null, focusName: null };

/** A port as the panel names it: its type, then its note (« Verdict des checks »). */
const portLabel = (port: Port): string => (port.note === undefined ? typeLabel(port.type) : `${typeLabel(port.type)} ${port.note}`);

const stepById = (definition: ProcessDefinition, id: string): Step | undefined => definition.steps.find((step) => step.id === id);
const phaseName = (definition: ProcessDefinition, step: Step): string => definition.phases.find((phase) => phase.id === step.phaseId)?.name ?? '';

/**
 * A Manque's row (pure): its label, where it is (« Merge · Développement »,
 * « Sources · produit par « PRD » »), and the block it leads to.
 */
export const gapRowOf = (gap: ProcessGap, definition: ProcessDefinition): GapRow => {
  const at = gapStep(gap);
  const step = at ? stepById(definition, at.stepId) : undefined;
  if (at && step) return { label: gap.label, meta: t('process.gaps.meta.step', { step: step.name, phase: phaseName(definition, step) }), target: { kind: 'step', id: step.id } };
  const [root, id] = gap.target.split('.');
  if (root === 'phases' && id) {
    const phase = definition.phases.find((candidate) => candidate.id === id);
    return { label: gap.label, meta: t('process.gaps.meta.phase', { phase: phase?.name ?? id }), target: { kind: 'phase', id } };
  }
  const type = id as ArtifactType | undefined;
  const producer = type && definition.steps.find((candidate) => candidate.outputs.some((port) => port.type === type));
  const consumer = type && definition.steps.find((candidate) => candidate.inputs.some((port) => port.type === type));
  const meta = producer
    ? t('process.gaps.meta.producedBy', { step: producer.name })
    : consumer
      ? t('process.gaps.meta.expectedBy', { step: consumer.name })
      : t('process.gaps.meta.sources');
  return { label: gap.label, meta, target: { kind: 'sources', id: id ?? null } };
};

/** The selection of the URL, if the shown definition has its block. */
const selectionIn = (definition: ProcessDefinition, selection: Selection | null): Selection | null => {
  if (selection?.kind === 'step' && selection.id && stepById(definition, selection.id)) return selection;
  if (selection?.kind === 'phase' && definition.phases.some((phase) => phase.id === selection.id)) return selection;
  return null;
};

interface Context {
  readonly definition: ProcessDefinition;
  readonly gaps: readonly ProcessGap[];
  readonly project: Project;
  readonly roleNames: Readonly<Record<string, string>>;
  readonly settings: AccountSettings | null;
  readonly accounts: readonly AiAccount[];
}

const roleDetail = (roleId: string, { settings, accounts }: Context): string | null => {
  if (!settings) return null;
  const roles = withDefaultRoles(settings.roles, accounts);
  const choice = Object.hasOwn(roles, roleId) ? roles[roleId] : null;
  if (!choice) return null;
  const label = accounts.find((account) => account.engine === choice.engine)?.models.find((model) => model.id === choice.model)?.label ?? choice.model;
  return t('settings.roles.model', { engine: t(`engine.${choice.engine}`), label });
};

const toolRow = (tool: Tool, context: Context): ToolRow => {
  switch (tool.kind) {
    case 'role':
      return { icon: 'user', label: t('process.tool.role', { name: roleName(tool.roleId, context.roleNames) }), detail: roleDetail(tool.roleId, context) };
    case 'skill':
      // Every Skill of the catalogue is an official one, embedded in the Runner (ADR 0004).
      return { icon: 'spark', label: t('process.tool.skill', { name: tool.skillId }), detail: t('process.tool.skill.official') };
    case 'mcp':
      return { icon: 'layers', label: t('process.tool.mcp', { name: tool.name }), detail: null };
    case 'connector':
      return { icon: 'plug', label: t('process.tool.connector'), detail: context.project.fullName };
    case 'command':
      // Its text is in the sealed part, PROCESS-12's to open.
      return { icon: 'terminal', label: t('process.tool.command'), detail: null };
  }
};

const names = (definition: ProcessDefinition, ids: readonly string[]): string =>
  [...new Set(ids)].map((id) => stepById(definition, id)?.name ?? id).join(', ');

/** The Étapes du produit and the Review, which `core.missing` keeps: what the panel says instead of « Retirer ». */
const KEPT: Partial<Record<Step['kind'], MessageKey>> = {
  review: 'process.step.keep.review',
  checks: 'process.step.keep.checks',
  merge: 'process.step.keep.merge',
};

/** Why « Retirer » is disabled for an Étape, `null` while it may go. */
const stepRemoveReason = (definition: ProcessDefinition, step: Step): string | null => {
  const check = canRemoveStep(definition, step.id);
  if (check.ok) return null;
  const kept = check.kind === 'core.missing' ? KEPT[step.kind] : undefined;
  return kept ? t(kept) : check.reason;
};

/**
 * Why « Retirer la Phase » is disabled, `null` while it may go: for
 * `core.missing`, the Review and the Merge it holds (the Checks when it
 * holds neither), « qui ne se retirent pas ».
 */
const phaseRemoveReason = (definition: ProcessDefinition, phaseId: string): string | null => {
  const check = canRemovePhase(definition, phaseId);
  if (check.ok) return null;
  if (check.kind !== 'core.missing') return check.reason;
  const kinds = new Set(definition.steps.filter((step) => step.phaseId === phaseId).map((step) => step.kind));
  const named = (['review', 'merge'] as const).filter((kind) => kinds.has(kind));
  const held = named.length > 0 ? named : kinds.has('checks') ? (['checks'] as const) : [];
  if (held.length === 0) return check.reason;
  const words = held.map((kind) => t(`process.phase.keep.${kind}`));
  const plural = held.length > 1 || held[0] === 'checks';
  const list = words.length > 1 ? t('process.phase.keep.and', { first: words.slice(0, -1).join(', '), last: words.at(-1)! }) : words[0]!;
  return t(plural ? 'process.phase.keep.other' : 'process.phase.keep.one', { held: list });
};

const stepPanel = (step: Step, context: Context): NonNullable<ProcessEditorData['step']> => {
  const { definition, gaps } = context;
  const phase = definition.phases.find((candidate) => candidate.id === step.phaseId);
  const unfed = new Set(gaps.filter((gap) => gap.kind === 'input.unfed').map((gap) => gap.target));
  const loopBack = definition.loopBacks.find((loop) => loop.from === step.id);
  return {
    id: step.id,
    phaseId: step.phaseId,
    name: step.name,
    kindLabel: kindLabelOf(step, phase),
    phaseName: phase?.name ?? '',
    loopBack: loopBack
      ? t('process.step.loopBack', { to: stepById(definition, loopBack.to)?.name ?? loopBack.to, from: step.name, max: loopBack.max })
      : null,
    inputs: step.inputs.map((port) => {
      const feeders = definition.arrows.filter((arrow) => arrow.to.stepId === step.id && arrow.to.portId === port.id).map((arrow) => arrow.from.stepId);
      const fed = !unfed.has(`steps.${step.id}.inputs.${port.id}`);
      const from =
        feeders.length > 0
          ? names(definition, feeders)
          : fed && phase?.forEach
            ? t('process.step.from.forEach', { forEach: FOR_EACH[phase.forEach].label })
            : t('process.step.from.nothing');
      return { label: portLabel(port), from: t('process.step.from', { from }), fed };
    }),
    outputs: step.outputs.map((port) => {
      const fed = definition.arrows.filter((arrow) => arrow.from.stepId === step.id && arrow.from.portId === port.id).map((arrow) => arrow.to.stepId);
      return { label: portLabel(port), to: t('process.step.to', { to: fed.length > 0 ? names(definition, fed) : t('process.step.to.nothing') }) };
    }),
    tools: step.tools.map((tool) => toolRow(tool, context)),
    phases: definition.phases.map((candidate) => ({ value: candidate.id, label: candidate.name })),
    removeReason: stepRemoveReason(definition, step),
  };
};

const plural = (count: number, key: 'process.phase.steps' | 'process.phase.loopBacks'): string => t(count === 1 ? `${key}.one` : `${key}.other`, { count });

/** « Répéter »'s choices: once, then ADR 0011's closed list. */
const REPEATS: readonly (ForEach | null)[] = [null, ...(Object.keys(FOR_EACH) as ForEach[])];

const phasePanel = (phaseId: string, definition: ProcessDefinition, edits: EditorEdits): NonNullable<ProcessEditorData['phase']> => {
  const phase = definition.phases.find((candidate) => candidate.id === phaseId)!;
  const steps = new Set(definition.steps.filter((step) => step.phaseId === phase.id).map((step) => step.id));
  const loopBacks = definition.loopBacks.filter((loop) => steps.has(loop.from)).length;
  return {
    id: phase.id,
    name: phase.name,
    count: t('process.phase.count', { steps: plural(steps.size, 'process.phase.steps'), loopBacks: plural(loopBacks, 'process.phase.loopBacks') }),
    repeat: REPEATS.map((forEach) => ({
      forEach,
      label: forEach ? t('process.phase.repeat.forEach', { forEach: FOR_EACH[forEach].label }) : t('process.phase.repeat.once'),
      checked: phase.forEach === forEach,
    })),
    help: t(phase.forEach ? `process.phase.help.${phase.forEach}` : 'process.phase.help.once'),
    removeReason: phaseRemoveReason(definition, phase.id),
    nameError: edits.nameError?.phaseId === phase.id ? edits.nameError.text : null,
    focusName: edits.focusName?.phaseId === phase.id ? edits.focusName.at : null,
  };
};

/** The Dialog removing a Phase with its Étapes, while asked. */
const removePhaseDialog = (definition: ProcessDefinition, phaseId: string | null): ProcessEditorData['removePhase'] => {
  const phase = definition.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) return null;
  const steps = definition.steps.filter((step) => step.phaseId === phase.id).map((step) => step.name);
  return {
    phaseId: phase.id,
    title: t('process.phase.remove.title', { name: phase.name }),
    body: t(steps.length === 1 ? 'process.phase.remove.body.one' : 'process.phase.remove.body.other', { count: steps.length, names: steps.join(', ') }),
  };
};

/**
 * The Sources (ADR 0012, « Which Source for what »), read: « Tickets » and
 * « Code et documents », each Local on the Runner's machine (never the
 * folder's path) or GitHub with the repository, the types the shown
 * definition passes and those it does not; the Idée « Crewdeck »; the
 * Livraison, when passed, without Source.
 */
const sourcesPanel = (view: ProjectProcess, definition: ProcessDefinition, project: Project, machine: string): ProcessEditorData['sources'] => {
  const passed = new Set(definition.steps.flatMap((step) => [...step.inputs, ...step.outputs].map((port) => port.type)));
  const typesOf = (group: string): readonly ArtifactType[] => GROUP_ORDER.filter((type) => TYPE_SOURCE[type] === group);
  const group = (id: 'ticket' | 'code', source: ProjectSource): SourceRow => {
    const held = typesOf(id).filter((type) => passed.has(type));
    const unused = typesOf(id).filter((type) => !passed.has(type));
    const place = source.source === 'github' ? (project.fullName ?? '') : t(`process.sources.${id}.local`, { machine });
    const parts = [
      // The Tickets' group holds only the Ticket: its place says it.
      ...(id === 'code' && held.length > 0 ? [t('process.sources.held', { types: held.map(typeLabel).join(', ') })] : []),
    ];
    const unusedText = unused.length > 0 ? t(unused.length === 1 ? 'process.sources.unused.one' : 'process.sources.unused.other', { types: unused.map(typeLabel).join(', ') }) : null;
    const types = parts.length > 0 && unusedText ? t('process.sources.join', { first: parts[0]!, second: unusedText }) : (parts[0] ?? unusedText);
    return {
      icon: source.source === 'github' ? 'github' : 'folder',
      label: t(`process.sources.${id}`),
      value: t(`process.sources.${source.source}`),
      detail: types ? t('process.sources.withPlace', { place, types }) : place,
    };
  };
  return {
    lead: t('process.sources.lead'),
    rows: [
      group('ticket', view.sources.ticket),
      group('code', view.sources.code),
      {
        icon: 'bulb',
        label: t('process.sources.idea'),
        value: t('process.sources.crewdeck'),
        detail: passed.has('idea') ? null : t('process.sources.unused.one', { types: typeLabel('idea') }),
      },
      ...(passed.has('delivery')
        ? [{ icon: 'send', label: t('process.sources.delivery'), value: t('process.sources.none'), detail: t('process.sources.delivery.none') } as const]
        : []),
    ],
  };
};

/** The code's types in the order the panel lists them: the code's own first, then the documents. */
const GROUP_ORDER: readonly ArtifactType[] = ['ticket', 'code-change', 'verdict', ...ARTIFACT_TYPES.filter((type) => !['ticket', 'code-change', 'verdict'].includes(type))];

const countOf = (view: ProjectProcess, gaps: number): string => {
  if (!view.active) return t('process.count.noVersion');
  if (!view.draft) return t('process.count.active', { number: view.active.number });
  if (gaps === 0) return t('process.count.draft');
  return t(gaps === 1 ? 'process.count.draftGaps.one' : 'process.count.draftGaps.other', { count: gaps });
};

const footerOf = (view: ProjectProcess): ProcessEditorData['footer'] => ({
  changes: !view.active
    ? t('process.footer.firstDraft')
    : view.draft
      ? t('process.footer.draft', { number: view.active.number })
      : t('process.footer.unchanged', { number: view.active.number }),
  versions: view.active ? t('process.footer.activeSince', { number: view.active.number, date: formatDate(view.active.activatedAt) }) : t('process.footer.noVersion'),
});

const EMPTY_DEFINITION: ProcessDefinition = { schemaVersion: 1, phases: [], steps: [], arrows: [], loopBacks: [], commands: [] };

/** The page without a Projet: « Ce Projet n'existe pas », or, until the snapshot came, nothing yet. */
const nothing = (found: boolean, ui: EditorUi): ProcessEditorData => ({
  found,
  title: { projectName: '', backHref: '/projets', count: '' },
  hasVersion: true,
  canvas: canvasOf(EMPTY_DEFINITION, [], null, { zoom: ui.zoom, pan: ui.pan, roleNames: {}, focus: null }),
  tab: ui.tab,
  gaps: [],
  step: null,
  phase: null,
  catalogue: null,
  toast: null,
  removePhase: null,
  sources: { lead: t('process.sources.lead'), rows: [] },
  footer: { changes: '', versions: '' },
});

/**
 * « Gestion du process »' data (pure, US-92, US-94, US-88): the draft when
 * there is one, else the active version, its Manques as `findGaps` gives them
 * for the Projet's Sources, the header's count, the panel's tab, the Étape or
 * Phase of the URL, the Sources and the versions. Editable (US-93, US-95):
 * the edits' view in place of the store's, the target Phase, why a block
 * does not go, the catalogue, the refusal and the Dialog asked.
 */
export const processEditorView = (
  state: ProcessEditorState,
  projectId: string,
  ui: EditorUi,
  edits: EditorEdits = NO_EDITS,
  // A Local Projet's name is sealed: the page opens it (PROJET-6, `projects.ts`).
  projectName: (project: Project) => string = (project) => project.displayName ?? '',
): ProcessEditorData => {
  const { slices } = state;
  if (!slices.project || !slices.process) return nothing(true, ui);
  const project = slices.project.get(projectId);
  const view = edits.shown ?? slices.process.get(projectId);
  const definition = view?.draft?.definition ?? view?.active?.definition;
  if (!project || !view || !definition) return nothing(false, ui);

  const gaps = findGaps(definition, processSourcesOf(view));
  const selection = selectionIn(definition, ui.selection);
  const settings = slices.settings ?? null;
  const roleNames = Object.fromEntries((settings?.customRoles ?? []).map((role) => [role.id, role.name]));
  const context: Context = { definition, gaps, project, roleNames, settings, accounts: [...(slices['ai-account']?.values() ?? [])] };
  const step = selection?.kind === 'step' && selection.id ? stepById(definition, selection.id) : undefined;
  const target = targetPhaseOf(definition, selection);

  return {
    found: true,
    title: { projectName: projectName(project), backHref: '/projets', count: countOf(view, gaps.length) },
    hasVersion: view.active !== null,
    canvas: canvasOf(definition, gaps, selection, { zoom: ui.zoom, pan: ui.pan, roleNames, focus: ui.focus, editable: true, target: target?.id ?? null }),
    tab: ui.tab,
    gaps: gaps.map((gap) => gapRowOf(gap, definition)),
    step: step ? stepPanel(step, context) : null,
    phase: selection?.kind === 'phase' && selection.id ? phasePanel(selection.id, definition, edits) : null,
    catalogue: edits.catalogue && target ? catalogueMenu(definition, target.name) : null,
    toast: edits.toast === null ? null : { tone: 'halt', icon: 'block', text: edits.toast },
    removePhase: removePhaseDialog(definition, edits.removingPhase),
    sources: sourcesPanel(view, definition, project, slices.runner?.machine ?? t('process.sources.machine.none')),
    footer: footerOf(view),
  };
};
