import {
  AGENT_ROLES,
  ARTIFACT_TYPES,
  CATALOGUE,
  diffDefinitions,
  FOR_EACH,
  findGaps,
  processSourcesOf,
  TYPE_SOURCE,
  withDefaultRoles,
  SOURCE_KINDS,
  type AccountSettings,
  type AiAccount,
  type Arrow,
  type ArtifactType,
  type CodeChange,
  type PhaseRun,
  type Port,
  type ProcessChange,
  type ProcessDefinition,
  type ProcessGap,
  type Project,
  type ProjectProcess,
  type ProjectSource,
  type Runner,
  type SourceMigration,
  type Step,
  type Ticket,
  type Tool,
  type ForEach,
  type McpServer,
} from '@crewdeck/contracts';
import { formatDate, t, type ComposantData, type MessageKey, type PageProcessEditor } from '@crewdeck/sdk';
import { canvasOf, gapStep, kindLabelOf, roleName, targetPhaseOf, typeLabel, type Selection } from '../process/canvas.js';
import { catalogueMenu } from '../process/catalogue-menu.js';
import { changeLabels } from '../process/diff-labels.js';
import { attachMenuOf, type AttachContext } from '../process/attach-menu.js';
import { canRemovePhase, canRemoveStep, candidates, loopBackTargets, takesTools, type PortRef } from '../process/edit.js';
import type { EditorUi, SourceChoice } from '../process/editor-ui.js';
import { runningByVersion, type WorkKind } from '../process/running-work.js';
import { sensitiveBlockedReason } from '../store/sensitive.js';
import type { StoreState } from '../store/store.js';
import { doneMeta, lastDoneOf, migrationBadge, migrationBanner, migrationMeta, runningMigrationOf, sourceLabel, type SourceMigrationReads } from './source-migration.js';

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
    /** The Serveurs MCP the Runner declares (RUNNER-16): « Attacher un Outil » offers their names. */
    readonly 'mcp-server'?: { values(): Iterable<Pick<McpServer, 'name'>> };
    readonly 'ai-account'?: { values(): Iterable<AiAccount> };
    readonly 'source-migration'?: ReadonlyMap<string, SourceMigration>;
    readonly 'phase-run'?: ReadonlyMap<string, PhaseRun>;
    readonly ticket?: ReadonlyMap<string, Ticket>;
    readonly 'code-change'?: ReadonlyMap<string, CodeChange>;
  };
}

/** What the Sources read of the store for a Projet (SOURCE-7): its migrations, its work, its Tickets and changes of code. */
export const sourceReadsOf = (state: ProcessEditorState, project: Project, definition: ProcessDefinition | null): SourceMigrationReads => {
  const { slices } = state;
  return {
    project,
    definition,
    migrations: [...(slices['source-migration']?.values() ?? [])],
    phaseRuns: [...(slices['phase-run']?.values() ?? [])],
    tickets: [...(slices.ticket?.values() ?? [])],
    codeChanges: [...(slices['code-change']?.values() ?? [])],
    machine: slices.runner?.machine ?? t('process.sources.machine.none'),
  };
};

/** A refusal or a notice of the edits over the canvas. */
export interface EditorToast {
  readonly tone: 'halt' | 'accent';
  readonly text: string;
  /** The arrow refused, drawn `refused` while the Toast stays. */
  readonly arrow: Arrow | null;
}

/** What the page's edits add to the store's view (PROCESS-8): `NO_EDITS` reads the store as is. */
export interface EditorEdits {
  /** The Process as the canvas shows it, its edits not saved yet included; `undefined`: the store's. */
  readonly shown?: ProjectProcess | undefined;
  /** Whether `shown` holds an edit the server has not confirmed yet: its revision is not one to activate. */
  readonly saving?: boolean;
  /** Whether the catalogue's Menu is open. */
  readonly catalogue: boolean;
  /** The Étape whose « Attacher un Outil » is open. */
  readonly attach?: string | null;
  /** The Phase whose removal the Dialog asks. */
  readonly removingPhase: string | null;
  /** The last refusal, in a halt Toast, with the arrow refused when it was one; or the last notice, in an accent one. */
  readonly toast: EditorToast | null;
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
  /** The names the Runner declares, `null` while the slice is unknown. */
  readonly mcpServers: ReadonlySet<string> | null;
  readonly machine: string;
}

const roleDetail = (roleId: string, { settings, accounts }: Context): string | null => {
  if (!settings) return null;
  const roles = withDefaultRoles(settings.roles, accounts);
  const choice = Object.hasOwn(roles, roleId) ? roles[roleId] : null;
  if (!choice) return null;
  const label = accounts.find((account) => account.engine === choice.engine)?.models.find((model) => model.id === choice.model)?.label ?? choice.model;
  return t('settings.roles.model', { engine: t(`engine.${choice.engine}`), label });
};

const toolRowOf = (tool: Tool, context: Context): Omit<ToolRow, 'tool' | 'detachLabel'> => {
  switch (tool.kind) {
    case 'role':
      return { icon: 'user', label: t('process.tool.role', { name: roleName(tool.roleId, context.roleNames) }), detail: roleDetail(tool.roleId, context) };
    case 'skill':
      // Every Skill of the catalogue is an official one, embedded in the Runner (ADR 0004).
      return { icon: 'spark', label: t('process.tool.skill', { name: tool.skillId }), detail: t('process.tool.skill.official') };
    case 'mcp':
      // A name the Runner no longer declares is a point of the Projet's preparation, not a Manque (ADR 0013).
      return {
        icon: 'layers',
        label: t('process.tool.mcp', { name: tool.name }),
        detail: context.mcpServers && !context.mcpServers.has(tool.name) ? t('process.tools.mcp.undeclared', { machine: context.machine }) : null,
      };
    case 'connector':
      return { icon: 'plug', label: t('process.tool.connector'), detail: context.project.fullName };
    case 'command':
      // Its text is in the sealed part, PROCESS-12's to open.
      return { icon: 'terminal', label: t('process.tool.command'), detail: null };
  }
};

/** An Outil's row, with its « Détacher le Rôle Review ». */
const toolRow = (tool: Tool, context: Context): ToolRow => {
  const row = toolRowOf(tool, context);
  return { ...row, tool, detachLabel: t(`process.tools.detach.${tool.kind}`, { label: row.label }) };
};

/** What a Retour stops at, beyond its maximum: what its Phase repeats for. */
const LOOP_ITEM: Readonly<Record<ForEach, MessageKey>> = {
  'ticket.ready': 'process.loopBack.item.ticket',
  'idea.retained': 'process.loopBack.item.design',
  'idea.noted': 'process.loopBack.item.idea',
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
  const nameOf = (id: string): string => stepById(definition, id)?.name ?? id;
  const panelArrow = (from: PortRef, to: PortRef, side: 'from' | 'to') => ({
    from: { ...from },
    to: { ...to },
    removeLabel: t(side === 'from' ? 'process.arrow.remove.from' : 'process.arrow.remove.to', { step: nameOf(side === 'from' ? from.stepId : to.stepId) }),
  });
  const judges = CATALOGUE[step.kind].judges;
  return {
    id: step.id,
    phaseId: step.phaseId,
    name: step.name,
    kindLabel: kindLabelOf(step, phase),
    phaseName: phase?.name ?? '',
    loopBack: loopBack
      ? {
          text: t('process.step.loopBack', {
            to: nameOf(loopBack.to),
            from: step.name,
            item: t(phase?.forEach ? LOOP_ITEM[phase.forEach] : 'process.loopBack.item.artifact'),
          }),
          max: loopBack.max,
        }
      : null,
    loopBackTargets:
      judges && !loopBack ? loopBackTargets(definition, step.id).map((id) => ({ value: id, label: nameOf(id) })) : null,
    inputs: step.inputs.map((port) => {
      const held = definition.arrows.filter((arrow) => arrow.to.stepId === step.id && arrow.to.portId === port.id);
      const feeders = held.map((arrow) => arrow.from.stepId);
      const fed = !unfed.has(`steps.${step.id}.inputs.${port.id}`);
      const from =
        feeders.length > 0
          ? names(definition, feeders)
          : fed && phase?.forEach
            ? t('process.step.from.forEach', { forEach: FOR_EACH[phase.forEach].label })
            : t('process.step.from.nothing');
      const input = { stepId: step.id, portId: port.id };
      return {
        id: port.id,
        label: portLabel(port),
        from: t('process.step.from', { from }),
        fed,
        arrows: held.map((arrow) => panelArrow(arrow.from, arrow.to, 'from')),
        candidates:
          held.length === 0
            ? candidates(definition, input).map((ref) => {
                const source = stepById(definition, ref.stepId);
                const out = source?.outputs.find((candidate) => candidate.id === ref.portId);
                return { from: { ...ref }, label: t('process.arrow.candidate', { port: out ? portLabel(out) : ref.portId, step: nameOf(ref.stepId) }) };
              })
            : null,
      };
    }),
    outputs: step.outputs.map((port) => {
      const held = definition.arrows.filter((arrow) => arrow.from.stepId === step.id && arrow.from.portId === port.id);
      const fed = held.map((arrow) => arrow.to.stepId);
      return {
        label: portLabel(port),
        to: t('process.step.to', { to: fed.length > 0 ? names(definition, fed) : t('process.step.to.nothing') }),
        arrows: held.map((arrow) => panelArrow(arrow.from, arrow.to, 'to')),
      };
    }),
    tools: step.tools.map((tool) => toolRow(tool, context)),
    canAttach: takesTools(step.kind),
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
 * The Sources (ADR 0012, « Which Source for what »): « Tickets » and « Code
 * et documents », each Local on the Runner's machine (never the folder's
 * path) or GitHub with the repository, the types the shown definition passes
 * and those it does not, and its Select (SOURCE-7: the choice not yet
 * confirmed while its dialog is open; disabled while the other group
 * migrates); a group migrating, its caution badge, where it is, and the
 * Banner; one migrated, since when and from where. A Local Projet (PROJET-6)
 * has no Dépôt GitHub to migrate to: its groups read, without a Select. The
 * Idée « Crewdeck »;
 * the Livraison, when passed, without Source.
 */
const sourcesPanel = (view: ProjectProcess, definition: ProcessDefinition, reads: SourceMigrationReads, choice: SourceChoice | null): ProcessEditorData['sources'] => {
  const { project, machine } = reads;
  const migrations = [...reads.migrations];
  const running = runningMigrationOf(migrations, project.id);
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
    const detail = types ? t('process.sources.withPlace', { place, types }) : place;
    const row = { label: t(`process.sources.${id}`), value: sourceLabel(source.source) };
    if (running?.group === id) return { ...row, icon: 'refresh', detail: migrationMeta(running), select: null, migration: migrationBadge(running) };
    const done = lastDoneOf(migrations, project.id, id);
    if (project.fullName === null) return { ...row, icon: 'folder', detail: done && done.to === source.source ? doneMeta(detail, done) : detail, select: null, migration: null };
    // The Pilote's pick, until the dialog confirms it or « Annuler » forgets it.
    const picked = choice?.group === id && choice.to !== source.source ? choice.to : null;
    return {
      ...row,
      icon: source.source === 'github' ? 'github' : 'folder',
      detail: picked ? t('process.sources.migration.chosen', { source: sourceLabel(picked) }) : done && done.to === source.source ? doneMeta(detail, done) : detail,
      select: {
        group: id,
        label: t(`process.sources.migration.${id}.select`),
        value: picked ?? source.source,
        options: SOURCE_KINDS.map((kind) => ({ value: kind, label: sourceLabel(kind) })),
        disabled: running !== null,
      },
      migration: null,
    };
  };
  return {
    lead: project.fullName === null ? t('process.sources.lead') : t('process.sources.migration.lead', { repository: project.fullName }),
    banner: running ? migrationBanner(running, reads) : null,
    rows: [
      group('ticket', view.sources.ticket),
      group('code', view.sources.code),
      {
        icon: 'bulb',
        label: t('process.sources.idea'),
        value: t('process.sources.crewdeck'),
        detail: passed.has('idea') ? null : t('process.sources.unused.one', { types: typeLabel('idea') }),
        select: null,
        migration: null,
      },
      ...(passed.has('delivery')
        ? [{ icon: 'send', label: t('process.sources.delivery'), value: t('process.sources.none'), detail: t('process.sources.delivery.none'), select: null, migration: null } as const]
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

/** The header's « Activer la v{n+1} »: disabled while an edit is saved, without a change, with a Manque, during the Resynchronisation. */
const activateOf = (
  state: ProcessEditorState,
  view: ProjectProcess,
  changes: readonly ProcessChange[],
  gaps: number,
  saving: boolean,
): ProcessEditorData['activate'] => {
  const label = t('process.activate', { number: (view.active?.number ?? 0) + 1 });
  // The shown draft carries the revision it rests on, not the one its save will give: none to confirm yet.
  if (saving) return { label, revision: null, disabledReason: t('process.activate.saving') };
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

/**
 * « Attacher un Outil », open for an Étape (PROCESS-9): the Rôles, the
 * Pilote's after the four of Crewdeck, each with its Moteur and model; the
 * Serveurs MCP the Runner declares (none while the slice is unknown); the
 * Projet's repository. The Commande's group waits for PROCESS-12.
 */
const attachOf = (definition: ProcessDefinition, stepId: string | null, context: Context): ProcessEditorData['attach'] => {
  if (stepId === null || !stepById(definition, stepId)) return null;
  const ids = [...AGENT_ROLES, ...(context.settings?.customRoles ?? []).map((role) => role.id)];
  const attach: AttachContext = {
    roles: ids.map((id) => ({ id, name: roleName(id, context.roleNames), detail: roleDetail(id, context) })),
    mcpServers: [...(context.mcpServers ?? [])].sort((a, b) => a.localeCompare(b, 'fr')),
    machine: context.machine,
    repository: context.project.fullName,
  };
  const menu = attachMenuOf(definition, stepId, attach, { commands: false });
  return menu ? { stepId, menu: menu.menu, choices: menu.choices.map((choice) => ({ id: choice.id, tool: choice.tool })) } : null;
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
  catalogue: null,
  attach: null,
  toast: ui.toast,
  removePhase: null,
  sources: { lead: t('process.sources.lead'), banner: null, rows: [] },
  footer: { changes: '', versions: '' },
  activate: null,
});

/**
 * « Gestion du process »' data (pure, US-92, US-94, US-88): the draft when
 * there is one, else the active version, its Manques as `findGaps` gives them
 * for the Projet's Sources, the header's count, the panel's tab, the Étape or
 * Phase of the URL, the Sources and the versions. Editable (US-93, US-95):
 * the edits' view in place of the store's, the target Phase, why a block
 * does not go, the catalogue, the refusal and the Dialog asked. Its arrows,
 * Retours and Outils (US-94, US-95, US-93): each arrow's « Retirer la
 * flèche », an Entrée's candidates, a Retour's targets and maximum, the
 * Outils' « Détacher », « Attacher un Outil » and its Menu, the arrow refused.
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
  const mcpSlice = slices['mcp-server'];
  const context: Context = {
    definition,
    gaps,
    project,
    roleNames,
    settings,
    accounts: [...(slices['ai-account']?.values() ?? [])],
    mcpServers: mcpSlice ? new Set([...mcpSlice.values()].map((server) => server.name)) : null,
    machine: slices.runner?.machine ?? t('process.sources.machine.none'),
  };
  const step = selection?.kind === 'step' && selection.id ? stepById(definition, selection.id) : undefined;
  // The page's own diff (ADR 0011): the server only refuses an empty one.
  const changes = view.active && view.draft ? diffDefinitions(view.active.definition, view.draft.definition) : [];
  const target = targetPhaseOf(definition, selection);

  return {
    found: true,
    title: { projectName: projectName(project), backHref: '/projets', count: countOf(view, changes, gaps.length) },
    hasVersion: view.active !== null,
    canvas: canvasOf(definition, gaps, selection, {
      zoom: ui.zoom,
      pan: ui.pan,
      roleNames,
      focus: ui.focus,
      editable: true,
      target: target?.id ?? null,
      refused: edits.toast?.arrow ?? null,
    }),
    tab: ui.tab,
    gaps: gaps.map((gap) => gapRowOf(gap, definition)),
    step: step ? stepPanel(step, context) : null,
    phase: selection?.kind === 'phase' && selection.id ? phasePanel(selection.id, definition, edits) : null,
    catalogue: edits.catalogue && target ? catalogueMenu(definition, target.name) : null,
    attach: attachOf(definition, edits.attach ?? null, context),
    // An edit's refusal or notice, else the activation's Toast: the edit's goes first, cleared at the next edit.
    toast: edits.toast === null ? ui.toast : edits.toast.tone === 'halt' ? { tone: 'halt', icon: 'block', text: edits.toast.text } : { tone: 'accent', icon: 'refresh', text: edits.toast.text },
    removePhase: removePhaseDialog(definition, edits.removingPhase),
    sources: sourcesPanel(view, definition, sourceReadsOf(state, project, view.active?.definition ?? definition), ui.choice ?? null),
    footer: footerOf(view, changes, roleNames),
    activate: activateOf(state, view, changes, gaps.length, edits.saving ?? false),
  };
};
