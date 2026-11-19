import { diffDefinitions, type ProcessRunningWork } from '@crewdeck/contracts';
import { t, type ComposantAction, type ComposantParsedPayload, type MessageKey, type MessageParams, type PageProcessEditor } from '@crewdeck/sdk';
import type { Client } from '../api/client.js';
import { activateProcess } from '../api/process.js';
import { ApiError } from '../api/request.js';
import type { ConfirmOptions } from '../dialogs/confirm.js';
import { changeLabels } from '../process/diff-labels.js';
import { editorQueryOf, processHref, type EditorUiState } from '../process/editor-ui.js';
import { runningByVersion, type WorkKind } from '../process/running-work.js';
import type { RouteMatch } from '../router.js';
import type { StoreState } from '../store/store.js';

type Payload<A extends ComposantAction<typeof PageProcessEditor>> = ComposantParsedPayload<typeof PageProcessEditor, A>;

export interface EditorActionsOptions {
  readonly ui: EditorUiState;
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

/**
 * The handlers of « Gestion du process » (US-92, US-94): the selection and
 * the tab written in the URL's query (replaced, so that Back leaves the
 * page), the block of a Manque centred, the canvas's view kept per Projet.
 */
export const createEditorActions = ({ ui, navigate, current, client, ideaTitle = () => null }: EditorActionsOptions) => {
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
        const view = state.slices.process?.get(projectId);
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
        try {
          const view = await activateProcess(client, projectId, { revision, seq });
          ui.toast(projectId, { tone: 'go', icon: 'check', text: t('process.activated', { number: view.active?.number ?? 1 }) });
        } catch (error) {
          ui.toast(projectId, { tone: 'halt', icon: 'block', text: error instanceof ApiError ? error.message : t('process.activate.failed') });
        }
      },
    },
  };
};

export type EditorActions = ReturnType<typeof createEditorActions>;
