import {
  ARTIFACT_TYPES,
  diffDefinitions,
  FOR_EACH,
  findGaps,
  processSourcesOf,
  TYPE_SOURCE,
  withDefaultRoles,
  type AccountSettings,
  type AiAccount,
  type ArtifactType,
  type Port,
  type ProcessChange,
  type ProcessDefinition,
  type ProcessGap,
  type Project,
  type ProjectProcess,
  type ProjectSource,
  type Runner,
  type Step,
  type Tool,
} from '@crewdeck/contracts';
import { formatDate, t, type ComposantData, type PageProcessEditor } from '@crewdeck/sdk';
import { canvasOf, gapStep, kindLabelOf, roleName, typeLabel, type Selection } from '../process/canvas.js';
import { changeLabels } from '../process/diff-labels.js';
import type { EditorUi } from '../process/editor-ui.js';
import { runningByVersion, type WorkKind } from '../process/running-work.js';
import { sensitiveBlockedReason } from '../store/sensitive.js';
import type { StoreState } from '../store/store.js';

export type ProcessEditorData = ComposantData<typeof PageProcessEditor>;
type GapRow = ProcessEditorData['gaps'][number];
type ToolRow = NonNullable<ProcessEditorData['step']>['tools'][number];
type SourceRow = ProcessEditorData['sources']['rows'][number];

/** What « Gestion du process » reads of the store. */
export interface ProcessEditorState {
  /** The store's connection: « Activer » waits for the end of the Resynchronisation; without it (no store), it does not. */
  readonly connection?: StoreState['connection'];
  readonly slices: {
    readonly project?: ReadonlyMap<string, Project>;
    readonly process?: ReadonlyMap<string, ProjectProcess>;
    readonly settings?: AccountSettings | null;
    readonly runner?: Pick<Runner, 'machine'> | null;
    readonly 'ai-account'?: { values(): Iterable<AiAccount> };
  };
}

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

const stepPanel = (step: Step, context: Context): NonNullable<ProcessEditorData['step']> => {
  const { definition, gaps } = context;
  const phase = definition.phases.find((candidate) => candidate.id === step.phaseId);
  const unfed = new Set(gaps.filter((gap) => gap.kind === 'input.unfed').map((gap) => gap.target));
  const loopBack = definition.loopBacks.find((loop) => loop.from === step.id);
  return {
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
  };
};

const plural = (count: number, key: 'process.phase.steps' | 'process.phase.loopBacks'): string => t(count === 1 ? `${key}.one` : `${key}.other`, { count });

const phasePanel = (phaseId: string, definition: ProcessDefinition): NonNullable<ProcessEditorData['phase']> => {
  const phase = definition.phases.find((candidate) => candidate.id === phaseId)!;
  const steps = new Set(definition.steps.filter((step) => step.phaseId === phase.id).map((step) => step.id));
  const loopBacks = definition.loopBacks.filter((loop) => steps.has(loop.from)).length;
  const repeat = phase.forEach ? t('process.phase.repeat.forEach', { forEach: FOR_EACH[phase.forEach].label }) : t('process.phase.repeat.once');
  return {
    name: phase.name,
    count: t('process.phase.count', { steps: plural(steps.size, 'process.phase.steps'), loopBacks: plural(loopBacks, 'process.phase.loopBacks') }),
    repeat,
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
    const place = source.source === 'github' ? project.fullName : t(`process.sources.${id}.local`, { machine });
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

/** `key.one` or `key.other` for `count`, its `{count}` filled. */
const counted = (key: string, count: number, params: Readonly<Record<string, string | number>> = {}): string =>
  t(`${key}.${count === 1 ? 'one' : 'other'}` as Parameters<typeof t>[0], { ...params, count });

/** The header's count: the active version, or the draft with its changes (or « première version ») and its Manques. */
const countOf = (view: ProjectProcess, changes: readonly ProcessChange[], gaps: number): string => {
  if (view.active && !view.draft) return t('process.count.active', { number: view.active.number });
  const parts = [t('process.count.draft')];
  if (!view.active) parts.push(t('process.count.firstVersion'));
  else if (changes.length > 0) parts.push(counted('process.count.changes', changes.length));
  if (gaps > 0) parts.push(counted('process.count.gaps', gaps));
  return parts.join(' · ');
};

const WORK_KEYS: Readonly<Record<WorkKind, string>> = {
  ticket: 'process.footer.running.ticket',
  design: 'process.footer.running.design',
  idea: 'process.footer.running.idea',
  other: 'process.footer.running.other',
};

/** « v3 active depuis le 4 nov. », then what is at work by version (« · 2 Tickets en cours finissent sur la v3 »), or « · aucun travail en cours ». */
const versionsOf = (view: ProjectProcess): string => {
  if (!view.active) return t('process.footer.noVersion');
  const since = t('process.footer.activeSince', { number: view.active.number, date: formatDate(view.active.activatedAt) });
  const byVersion = runningByVersion(view.running, [view.active.definition, view.draft?.definition]);
  const running = byVersion.flatMap(({ versionNumber, kinds }) => kinds.map(({ kind, works }) => counted(WORK_KEYS[kind], works.length, { number: versionNumber })));
  return [since, ...(running.length > 0 ? running : [t('process.footer.running.none')])].join(' · ');
};

const footerOf = (view: ProjectProcess, changes: readonly ProcessChange[], roleNames: Readonly<Record<string, string>>): ProcessEditorData['footer'] => ({
  changes: !view.active
    ? t('process.footer.firstDraft')
    : changes.length > 0
      ? counted('process.footer.changes', changes.length, { number: view.active.number, list: changeLabels(changes, roleNames).join(' ; ') })
      : t('process.footer.unchanged', { number: view.active.number }),
  versions: versionsOf(view),
});

/** The header's « Activer la v{n+1} »: disabled without a change, with a Manque, during the Resynchronisation. */
const activateOf = (state: ProcessEditorState, view: ProjectProcess, changes: readonly ProcessChange[], gaps: number): ProcessEditorData['activate'] => {
  const label = t('process.activate', { number: (view.active?.number ?? 0) + 1 });
  const revision = view.draft?.revision ?? null;
  const unchanged = !view.draft || (view.active !== null && changes.length === 0);
  const disabledReason = unchanged
    ? t('process.activate.noChange')
    : gaps > 0
      ? t('process.activate.hasGaps')
      : state.connection === undefined
        ? null
        : sensitiveBlockedReason({ connection: state.connection });
  return { label, revision, disabledReason };
};

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
  sources: { lead: t('process.sources.lead'), rows: [] },
  footer: { changes: '', versions: '' },
  activate: null,
  toast: ui.toast,
});

/**
 * « Gestion du process »' data (pure, US-92, US-94, US-88): the draft when
 * there is one, else the active version, its Manques as `findGaps` gives them
 * for the Projet's Sources, the header's count, the panel's tab, the Étape or
 * Phase of the URL, the Sources and the versions.
 */
export const processEditorView = (state: ProcessEditorState, projectId: string, ui: EditorUi): ProcessEditorData => {
  const { slices } = state;
  if (!slices.project || !slices.process) return nothing(true, ui);
  const project = slices.project.get(projectId);
  const view = slices.process.get(projectId);
  const definition = view?.draft?.definition ?? view?.active?.definition;
  if (!project || !view || !definition) return nothing(false, ui);

  const gaps = findGaps(definition, processSourcesOf(view));
  const selection = selectionIn(definition, ui.selection);
  const settings = slices.settings ?? null;
  const roleNames = Object.fromEntries((settings?.customRoles ?? []).map((role) => [role.id, role.name]));
  const context: Context = { definition, gaps, project, roleNames, settings, accounts: [...(slices['ai-account']?.values() ?? [])] };
  const step = selection?.kind === 'step' && selection.id ? stepById(definition, selection.id) : undefined;
  // The page's own diff (ADR 0011): the server only refuses an empty one.
  const changes = view.active && view.draft ? diffDefinitions(view.active.definition, view.draft.definition) : [];

  return {
    found: true,
    title: { projectName: project.displayName, backHref: '/projets', count: countOf(view, changes, gaps.length) },
    hasVersion: view.active !== null,
    canvas: canvasOf(definition, gaps, selection, { zoom: ui.zoom, pan: ui.pan, roleNames, focus: ui.focus }),
    tab: ui.tab,
    gaps: gaps.map((gap) => gapRowOf(gap, definition)),
    step: step ? stepPanel(step, context) : null,
    phase: selection?.kind === 'phase' && selection.id ? phasePanel(selection.id, definition) : null,
    sources: sourcesPanel(view, definition, project, slices.runner?.machine ?? t('process.sources.machine.none')),
    footer: footerOf(view, changes, roleNames),
    activate: activateOf(state, view, changes, gaps.length),
    toast: ui.toast,
  };
};
