import { PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, type ProcessDefinition, type ProcessRunningWork, type Project, type ProjectProcess } from '@crewdeck/contracts';
import { createEditorActions, type EditorActionsOptions } from './process-editor.js';
import { ApiError } from '../api/request.js';
import { createEditorUi } from '../process/editor-ui.js';

const setup = (query: Record<string, string> = {}, options: Partial<EditorActionsOptions> = {}) => {
  const ui = createEditorUi();
  const navigate = vi.fn<(url: string, options?: { replace?: boolean }) => void>();
  const actions = createEditorActions({ ui, navigate, current: () => ({ params: { id: 'p1' }, query }), ...options });
  return { ui, navigate, actions };
};

const SINCE = '2026-11-04T12:00:00.000Z';
const PROJECT = { id: 'p1', displayName: 'Site mairie' } as Project;
const VERSION_3: NonNullable<ProjectProcess['active']> = {
  number: 3,
  definition: PROCESS_CREWDECK,
  sealed: null,
  activatedAt: SINCE,
  activatedBy: 'pilot',
  templateName: PROCESS_CREWDECK_NAME,
};
const THREE_CHANGES: ProcessDefinition = (() => {
  const draft = structuredClone(PROCESS_CREWDECK);
  draft.steps.find((step) => step.id === 'st-maquettes')!.tools.push({ kind: 'mcp', name: 'Stitch' }, { kind: 'mcp', name: 'Figma' });
  draft.loopBacks.find((loopBack) => loopBack.from === 'st-review')!.max = 5;
  return draft;
})();
const draftOf = (definition: ProcessDefinition, baseVersion = 3): NonNullable<ProjectProcess['draft']> => ({ definition, sealed: null, revision: 4, baseVersion, updatedAt: SINCE });
const work = (n: number, versionNumber: number, phaseId: string, ticketNumber: number | null): ProcessRunningWork => ({
  phaseRunId: `019a6f00-0000-7000-8000-0000000001${n}0`,
  versionNumber,
  phaseId,
  itemType: ticketNumber === null ? 'idea' : 'ticket',
  itemId: `idea-${n}`,
  ticketNumber,
});
const sources = { ticket: { source: 'github', since: SINCE }, code: { source: 'github', since: SINCE } } as const;
const stateOf = (process: Partial<ProjectProcess>) => ({
  slices: {
    project: new Map([[PROJECT.id, PROJECT]]),
    process: new Map([['p1', { id: 'p1', active: VERSION_3, draft: draftOf(THREE_CHANGES), sources, running: [], ...process }]]),
  },
});

describe('createEditorActions', () => {
  it('selects a block of the canvas on its tab, in the URL’s query, without centring it', () => {
    const { ui, navigate, actions } = setup({ onglet: 'sources' });
    actions.select({ target: { kind: 'step', id: 'st-review' }, centre: false });

    expect(navigate).toHaveBeenCalledWith('/projets/p1/process?etape=st-review', { replace: true });
    expect(ui.view('p1', { etape: 'st-review' }).focus).toEqual({ id: 'st-review', at: 0 });
  });

  it('selects the block of a Manque, opens its tab and centres it', () => {
    const { ui, navigate, actions } = setup();
    ui.view('p1', {});
    actions.select({ target: { kind: 'phase', id: 'ph-dev' }, centre: true });

    expect(navigate).toHaveBeenCalledWith('/projets/p1/process?phase=ph-dev', { replace: true });
    expect(ui.view('p1', { phase: 'ph-dev' }).focus).toEqual({ id: 'ph-dev', at: 1 });
  });

  it('opens « Sources » for a Manque of the Sources, the selection kept', () => {
    const { ui, navigate, actions } = setup({ etape: 'st-code' });
    ui.view('p1', { etape: 'st-code' });
    actions.select({ target: { kind: 'sources', id: 'prd' }, centre: true });

    expect(navigate).toHaveBeenCalledWith('/projets/p1/process?etape=st-code&onglet=sources', { replace: true });
    expect(ui.view('p1', {}).focus).toEqual({ id: 'st-code', at: 0 });
  });

  it('clears the selection, its tab kept', () => {
    const { navigate, actions } = setup({ etape: 'st-code' });
    actions.select({ target: null, centre: false });
    expect(navigate).toHaveBeenCalledWith('/projets/p1/process?onglet=etape', { replace: true });
  });

  it('opens a tab, the selection kept', () => {
    const { navigate, actions } = setup({ phase: 'ph-dev' });
    actions.tab({ tab: 'gaps' });
    expect(navigate).toHaveBeenCalledWith('/projets/p1/process?phase=ph-dev&onglet=manques', { replace: true });
  });

  it('keeps the canvas’s view for the Projet', () => {
    const { ui, navigate, actions } = setup();
    actions.view({ zoom: 120, pan: { x: 10, y: 20 } });
    expect(ui.view('p1', {})).toMatchObject({ zoom: 120, pan: { x: 10, y: 20 } });
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('activate', () => {
    it('confirms the v4 with the three changes, and the work in progress by version, titled when the page has it', () => {
      const running = [work(1, 2, 'ph-conception', null), work(2, 3, 'ph-dev', 53), work(3, 3, 'ph-dev', 57)];
      const { actions } = setup({}, { ideaTitle: (id) => (id === 'idea-1' ? 'Actualités' : null) });

      expect(actions.activate.confirmation({ revision: 4 }, stateOf({ running }))).toEqual({
        title: 'Activer la v4 du Process de Site mairie ?',
        confirmLabel: 'Activer la v4',
        icon: 'check',
        consequences: {
          lead: '3 changements depuis la v3 :',
          items: [
            { strong: '', text: 'Serveur MCP « Stitch » attaché à « Maquettes » ;' },
            { strong: '', text: 'Serveur MCP « Figma » attaché à « Maquettes » ;' },
            { strong: '', text: 'Retour de « Review » vers « Code » : 5 fois au plus, au lieu de 3.' },
          ],
          note: 'Le travail qui démarre ensuite suit la v4. Ce qui est en cours finit sur la version où il a démarré : les Tickets #53 et #57 sur la v3, la Conception « Actualités » sur la v2.',
        },
      });
    });

    it('counts the work it cannot name, and says when none is in progress', () => {
      const { actions } = setup();
      const counted = actions.activate.confirmation({ revision: 4 }, stateOf({ running: [work(1, 3, 'ph-conception', null), work(2, 3, 'ph-idee', null), work(3, 3, 'ph-dev', 53)] }));
      expect(counted.consequences.note).toBe(
        'Le travail qui démarre ensuite suit la v4. Ce qui est en cours finit sur la version où il a démarré : le Ticket #53 sur la v3, 1 Conception sur la v3, 1 Idée sur la v3.',
      );
      expect(actions.activate.confirmation({ revision: 4 }, stateOf({})).consequences.note).toBe('Le travail qui démarre ensuite suit la v4. Aucun travail en cours.');
    });

    it('confirms a first version without a list of changes', () => {
      const { actions } = setup();
      expect(actions.activate.confirmation({ revision: 4 }, stateOf({ active: null, draft: draftOf(PROCESS_CREWDECK, 0) }))).toEqual({
        title: 'Activer la v1 du Process de Site mairie ?',
        confirmLabel: 'Activer la v1',
        icon: 'check',
        consequences: {
          lead: 'La première version du Process de Site mairie : son travail pourra démarrer.',
          note: 'Le travail qui démarre ensuite suit la v1. Aucun travail en cours.',
        },
      });
    });

    it('activates the revision with the seq of the dialog, then says « Version 4 active. »', async () => {
      const command = vi.fn(async () => ({ id: 'p1', active: { ...VERSION_3, number: 4 }, draft: null, sources, running: [] }));
      const { ui, actions } = setup({}, { client: { command } as never });
      await actions.activate.run({ revision: 4 }, { seq: 41n });

      expect(command).toHaveBeenCalledWith('POST', '/api/projects/p1/process/activate', { revision: 4, seq: 41n }, expect.anything());
      expect(ui.view('p1', {}).toast).toEqual({ tone: 'go', icon: 'check', text: 'Version 4 active.' });
    });

    it('says a refusal in a halt Toast', async () => {
      const refusal = new ApiError({ status: 422, code: 'process.has-gaps', message: 'Ce brouillon a des Manques : règle-les avant de l’activer.' });
      const { ui, actions } = setup({}, { client: { command: vi.fn(async () => Promise.reject(refusal)) } as never });
      await actions.activate.run({ revision: 4 }, { seq: 41n });

      expect(ui.view('p1', {}).toast).toEqual({ tone: 'halt', icon: 'block', text: 'Ce brouillon a des Manques : règle-les avant de l’activer.' });
    });
  });
});
