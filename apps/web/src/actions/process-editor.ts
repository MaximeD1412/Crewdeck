import type { ProcessDefinition } from '@crewdeck/contracts';
import type { ComposantAction, ComposantParsedPayload, PageProcessEditor } from '@crewdeck/sdk';
import type { Client } from '../api/client.js';
import { migrateSource } from '../api/source-migrations.js';
import { targetPhaseOf } from '../process/canvas.js';
import { addPhase, addStep, moveStep, moveStepToPhase, removePhase, removeStep, renamePhase, setForEach, type EditResult } from '../process/edit.js';
import type { Editing } from '../process/editing.js';
import { editorQueryOf, processHref, type EditorUiState } from '../process/editor-ui.js';
import type { RouteMatch } from '../router.js';
import { sourceReadsOf, type ProcessEditorState } from '../views/process-editor.js';
import { migrationConfirmation } from '../views/source-migration.js';
import type { SensitiveActionHandler } from './dispatcher.js';

type Payload<A extends ComposantAction<typeof PageProcessEditor>> = ComposantParsedPayload<typeof PageProcessEditor, A>;

export interface EditorActionsOptions {
  readonly ui: EditorUiState;
  /** The Projets' edits and their drafts (PROCESS-8). */
  readonly editing: Editing;
  readonly navigate: (url: string, options?: { replace?: boolean }) => void;
  /** The page's match: its Projet's id, its query. */
  readonly current: () => Pick<RouteMatch, 'params' | 'query'>;
}

/** The id of the block an accepted edit added: in `after`, not in `before`. */
const addedId = (before: ProcessDefinition, after: ProcessDefinition, blocks: 'phases' | 'steps'): string | undefined => {
  const ids = new Set(before[blocks].map((block) => block.id));
  return after[blocks].find((block) => !ids.has(block.id))?.id;
};

/**
 * The handlers of « Gestion du process » (US-92, US-94): the selection and
 * the tab written in the URL's query (replaced, so that Back leaves the
 * page), the block of a Manque centred, the canvas's view kept per Projet.
 * Its edits (US-93, US-95): each applied to the shown definition and saved
 * behind, a refusal said in the Toast (a name's under its field); the Étape
 * or Phase added selected, a Phase's name focused; a Phase with Étapes
 * removed once the Dialog confirms.
 */
export const createEditorActions = ({ ui, editing, navigate, current }: EditorActionsOptions) => {
  const here = () => {
    const match = current();
    return { projectId: match.params['id'] ?? '', query: editorQueryOf(match.query) };
  };
  const selectBlock = (projectId: string, kind: 'step' | 'phase', id: string): void =>
    navigate(processHref(projectId, { selection: { kind, id }, tab: 'selection' }), { replace: true });
  const unselect = (projectId: string): void => navigate(processHref(projectId, { selection: null, tab: 'gaps' }), { replace: true });
  /** Applies an edit; refused, its reason in the Toast. */
  const edit = (projectId: string, change: (definition: ProcessDefinition) => EditResult): EditResult => {
    const result = editing.apply(projectId, change);
    if (!result.ok) editing.refuse(projectId, result.reason);
    return result;
  };
  const removeThePhase = (projectId: string, phaseId: string): void => {
    const { query } = here();
    const result = edit(projectId, (definition) => removePhase(definition, phaseId));
    if (result.ok && query.selection?.kind === 'phase' && query.selection.id === phaseId) unselect(projectId);
  };
  return {
    select: ({ target, centre }: Payload<'select'>): void => {
      const { projectId, query } = here();
      if (target?.kind === 'sources') return navigate(processHref(projectId, { selection: query.selection, tab: 'sources' }), { replace: true });
      if (!target?.id) return navigate(processHref(projectId, { selection: null, tab: query.tab }), { replace: true });
      navigate(processHref(projectId, { selection: { kind: target.kind, id: target.id }, tab: 'selection' }), { replace: true });
      if (centre) ui.centre(projectId, target.id);
    },
    tab: ({ tab }: Payload<'tab'>): void => {
      const { projectId, query } = here();
      navigate(processHref(projectId, { selection: query.selection, tab }), { replace: true });
    },
    view: (view: Payload<'view'>): void => ui.setView(here().projectId, view),
    addPhase: (): void => {
      const { projectId } = here();
      const before = editing.definition(projectId);
      const result = edit(projectId, addPhase);
      const id = before && result.ok ? addedId(before, result.definition, 'phases') : undefined;
      if (!id) return;
      selectBlock(projectId, 'phase', id);
      editing.focusName(projectId, id);
    },
    openCatalogue: (): void => editing.setCatalogue(here().projectId, true),
    closeMenu: (): void => editing.setCatalogue(here().projectId, false),
    addStep: ({ kind }: Payload<'addStep'>): void => {
      const { projectId, query } = here();
      editing.setCatalogue(projectId, false);
      const before = editing.definition(projectId);
      const target = before && targetPhaseOf(before, query.selection);
      if (!before || !target) return;
      const result = edit(projectId, (definition) => addStep(definition, kind, target.id));
      const id = result.ok ? addedId(before, result.definition, 'steps') : undefined;
      if (id) selectBlock(projectId, 'step', id);
    },
    moveStep: ({ stepId, phaseId, col, row }: Payload<'moveStep'>): void => {
      edit(here().projectId, (definition) => moveStep(definition, stepId, phaseId, col, row));
    },
    moveStepToPhase: ({ stepId, phaseId }: Payload<'moveStepToPhase'>): void => {
      edit(here().projectId, (definition) => moveStepToPhase(definition, stepId, phaseId));
    },
    removeStep: ({ stepId }: Payload<'removeStep'>): void => {
      const { projectId, query } = here();
      const result = edit(projectId, (definition) => removeStep(definition, stepId));
      if (result.ok && query.selection?.kind === 'step' && query.selection.id === stepId) unselect(projectId);
    },
    renamePhase: ({ phaseId, name }: Payload<'renamePhase'>): void => {
      const { projectId } = here();
      const result = editing.apply(projectId, (definition) => renamePhase(definition, phaseId, name));
      if (!result.ok) editing.refuseName(projectId, phaseId, result.reason);
    },
    setForEach: ({ phaseId, forEach }: Payload<'setForEach'>): void => {
      edit(here().projectId, (definition) => setForEach(definition, phaseId, forEach));
    },
    removePhase: ({ phaseId }: Payload<'removePhase'>): void => {
      const { projectId } = here();
      const holds = editing.definition(projectId)?.steps.some((step) => step.phaseId === phaseId) ?? false;
      if (holds) return editing.askRemovePhase(projectId, phaseId);
      removeThePhase(projectId, phaseId);
    },
    cancelRemovePhase: (): void => editing.askRemovePhase(here().projectId, null),
    confirmRemovePhase: ({ phaseId }: Payload<'confirmRemovePhase'>): void => {
      const { projectId } = here();
      editing.askRemovePhase(projectId, null);
      removeThePhase(projectId, phaseId);
    },
  };
};

export type EditorActions = ReturnType<typeof createEditorActions>;

export interface MigrateActionOptions {
  readonly ui: Pick<EditorUiState, 'choose'>;
  readonly client: Pick<Client, 'command'>;
  /** The page's match: its Projet's id. */
  readonly current: () => Pick<RouteMatch, 'params'>;
}

/**
 * « Migrer » a group of the Sources (SOURCE-7, US-102), the Action sensible
 * `source.migrate`: the core's dialog says what the migration holds, copies
 * and archives; the group's Select shows the choice while it is open and
 * goes back once answered; confirmed, the migration is asked with the `seq`
 * seen when the dialog opened, and the store shows it running, live. A
 * refusal is an `ApiError`, which the page shows.
 */
export const createMigrateAction = ({ ui, client, current }: MigrateActionOptions): SensitiveActionHandler<Payload<'migrate'>> => {
  const projectId = () => current().params['id'] ?? '';
  return {
    confirmation: ({ group, to }, state) => {
      const slices = state.slices as ProcessEditorState['slices'];
      const project = slices.project?.get(projectId());
      const view = slices.process?.get(projectId());
      const definition = view?.active?.definition ?? view?.draft?.definition ?? null;
      const from = view?.sources[group].source ?? (to === 'github' ? 'local' : 'github');
      if (!project) throw new Error(`Projet ${projectId()} absent du store`);
      return migrationConfirmation(sourceReadsOf(state as ProcessEditorState, project, definition), group, from, to);
    },
    pending: (choice) => {
      const id = projectId();
      ui.choose(id, choice);
      return () => ui.choose(id, null);
    },
    run: async ({ group, to }, { seq }) => {
      await migrateSource(client, projectId(), group, to, seq);
    },
  };
};
