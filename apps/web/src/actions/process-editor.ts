import type { ComposantAction, ComposantParsedPayload, PageProcessEditor } from '@crewdeck/sdk';
import type { Client } from '../api/client.js';
import { migrateSource } from '../api/source-migrations.js';
import { editorQueryOf, processHref, type EditorUiState } from '../process/editor-ui.js';
import type { RouteMatch } from '../router.js';
import { sourceReadsOf, type ProcessEditorState } from '../views/process-editor.js';
import { migrationConfirmation } from '../views/source-migration.js';
import type { SensitiveActionHandler } from './dispatcher.js';

type Payload<A extends ComposantAction<typeof PageProcessEditor>> = ComposantParsedPayload<typeof PageProcessEditor, A>;

export interface EditorActionsOptions {
  readonly ui: EditorUiState;
  readonly navigate: (url: string, options?: { replace?: boolean }) => void;
  /** The page's match: its Projet's id, its query. */
  readonly current: () => Pick<RouteMatch, 'params' | 'query'>;
}

/**
 * The handlers of « Gestion du process » (US-92, US-94): the selection and
 * the tab written in the URL's query (replaced, so that Back leaves the
 * page), the block of a Manque centred, the canvas's view kept per Projet.
 */
export const createEditorActions = ({ ui, navigate, current }: EditorActionsOptions) => {
  const here = () => {
    const match = current();
    return { projectId: match.params['id'] ?? '', query: editorQueryOf(match.query) };
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
