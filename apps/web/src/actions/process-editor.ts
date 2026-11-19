import { diffDefinitions, type ProcessDefinition, type ProcessRunningWork } from '@crewdeck/contracts';
import { t, type ComposantAction, type ComposantParsedPayload, type MessageKey, type MessageParams, type PageProcessEditor } from '@crewdeck/sdk';
import type { Client } from '../api/client.js';
import { activateProcess } from '../api/process.js';
import { ApiError } from '../api/request.js';
import type { ConfirmOptions } from '../dialogs/confirm.js';
import { targetPhaseOf } from '../process/canvas.js';
import { changeLabels } from '../process/diff-labels.js';
import { addPhase, addStep, moveStep, moveStepToPhase, removePhase, removeStep, renamePhase, setForEach, type EditResult } from '../process/edit.js';
import type { Editing } from '../process/editing.js';
import { editorQueryOf, processHref, type EditorUiState } from '../process/editor-ui.js';
import { runningByVersion, type WorkKind } from '../process/running-work.js';
import type { RouteMatch } from '../router.js';
import type { StoreState } from '../store/store.js';

type Payload<A extends ComposantAction<typeof PageProcessEditor>> = ComposantParsedPayload<typeof PageProcessEditor, A>;

export interface EditorActionsOptions {
  readonly ui: EditorUiState;
  /** The Projets' edits and their drafts (PROCESS-8). */
  readonly editing: Editing;
  readonly navigate: (url: string, options?: { replace?: boolean }) => void;
  /** The page's match: its Projet's id, its query. */
  readonly current: () => Pick<RouteMatch, 'params' | 'query'>;
  /** The API, for `process.activate`. */
  readonly client?: Pick<Client, 'command'>;
  /** An Idée's title, when the page holds it opened (its first line); else `null`, and it is counted. */
  readonly ideaTitle?: (ideaId: string) => string | null;
}

type Confirmation = Omit<ConfirmOptions, 'action'>;

/** `key.one` or `key.other` for `count`, its `{count}` filled. */
const counted = (key: string, count: number, params: MessageParams = {}): string =>
  t(`${key}.${count === 1 ? 'one' : 'other'}` as MessageKey, { ...params, count });

const and = (parts: readonly string[]): string => new Intl.ListFormat('fr', { type: 'conjunction' }).format(parts);

/**
 * The work of a kind at work on a version, as the note says it: named when
 * each one is (« les Tickets #53 et #57 », « la Conception « Actualités » »),
 * else counted (« 1 Conception »).
 */
const worksPhrase = (kind: WorkKind, works: readonly ProcessRunningWork[], ideaTitle: (ideaId: string) => string | null): string => {
  const names = works.map((work) => {
    if (kind === 'ticket') return work.ticketNumber === null ? null : t('process.confirm.ticketName', { number: work.ticketNumber });
    if (kind === 'other') return null;
    const title = ideaTitle(work.itemId);
    return title ? t('process.confirm.ideaName', { title }) : null;
  });
  if (kind !== 'other' && names.every((name) => name !== null)) return counted(`process.confirm.work.${kind}.named`, works.length, { names: and(names as string[]) });
  return counted(`process.confirm.work.${kind}.counted`, works.length);
};

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
export const createEditorActions = ({ ui, editing, navigate, current, client, ideaTitle = () => null }: EditorActionsOptions) => {
  const here = () => {
    const match = current();
    return { projectId: match.params['id'] ?? '', query: editorQueryOf(match.query) };
  };
  /**
   * The Projet the open confirmation names, kept from its opening to its run:
   * the page may move to another Projet while the dialog stays open, and the
   * route must activate the Process the Pilote confirmed (the dispatcher opens
   * one confirmation at a time).
   */
  let confirming: string | null = null;
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
    /**
     * « Activer la v{n+1} », the Action sensible `process.activate` (US-96,
     * ADR 0011): its confirmation lists the page's diff since the active
     * version and the work staying on its version; once confirmed, the route,
     * then a Toast says the version active, or the refusal.
     */
    activate: {
      confirmation: (_payload: Payload<'activate'>, state: Pick<StoreState, 'slices'>): Confirmation => {
        const { projectId } = here();
        confirming = projectId;
        // What the page shows (PROCESS-8): its edits not saved yet included.
        const view = editing.edits(projectId).shown ?? state.slices.process?.get(projectId);
        const projectName = state.slices.project?.get(projectId)?.displayName ?? '';
        const active = view?.active ?? null;
        const next = (active?.number ?? 0) + 1;
        const roleNames = Object.fromEntries((state.slices.settings?.customRoles ?? []).map((role) => [role.id, role.name]));
        const changes = active && view?.draft ? changeLabels(diffDefinitions(active.definition, view.draft.definition), roleNames) : [];
        const groups = runningByVersion(view?.running ?? [], [active?.definition, view?.draft?.definition]);
        const list = groups.flatMap(({ versionNumber, kinds }) =>
          kinds.map(({ kind, works }) => t('process.confirm.onVersion', { works: worksPhrase(kind, works, ideaTitle), number: versionNumber })),
        );
        const note = list.length === 0 ? t('process.confirm.note.none', { number: next }) : t('process.confirm.note', { number: next, list: list.join(', ') });
        return {
          title: t('process.confirm.title', { number: next, projectName }),
          confirmLabel: t('process.activate', { number: next }),
          icon: 'check',
          consequences: active
            ? {
                lead: counted('process.confirm.lead', changes.length, { number: active.number }),
                items: changes.map((label, index) => ({ strong: '', text: `${label}${index === changes.length - 1 ? '.' : ' ;'}` })),
                note,
              }
            : { lead: t('process.confirm.firstLead', { projectName }), note },
        };
      },
      run: async ({ revision }: Payload<'activate'>, { seq }: { readonly seq: bigint }): Promise<void> => {
        const projectId = confirming;
        confirming = null;
        if (!client || projectId === null) return;
        // An edit still being saved lands first: its new revision then refuses the one confirmed (409).
        await editing.settled();
        try {
          const view = await activateProcess(client, projectId, { revision, seq });
          ui.toast(projectId, { tone: 'go', icon: 'check', text: t('process.activated', { number: view.active?.number ?? 1 }) });
        } catch (error) {
          ui.toast(projectId, { tone: 'halt', icon: 'block', text: error instanceof ApiError ? error.message : t('process.activate.failed') });
        }
      },
    },
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
