import { PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, type ProcessDefinition, type ProcessDraftInput, type ProcessRunningWork, type Project, type ProjectProcess } from '@crewdeck/contracts';
import { ApiError } from '../api/request.js';
import { createEditing } from '../process/editing.js';
import type { StoreState } from '../store/store.js';
import { createEditorActions, createMigrateAction, type EditorActionsOptions } from './process-editor.js';
import { createEditorUi } from '../process/editor-ui.js';

const PROCESS: ProjectProcess = {
  id: 'p1',
  active: { number: 1, definition: PROCESS_CREWDECK, sealed: null, activatedAt: '2026-11-15T08:00:00.000Z', activatedBy: 'creation', templateName: PROCESS_CREWDECK_NAME },
  draft: null,
  sources: { ticket: { source: 'github', since: '2026-11-15T08:00:00.000Z' }, code: { source: 'github', since: '2026-11-15T08:00:00.000Z' } },
  running: [],
};

const answered = (input: ProcessDraftInput): ProjectProcess => ({
  ...PROCESS,
  draft: { definition: input.definition, sealed: input.sealed, revision: input.revision + 1, baseVersion: input.baseVersion, updatedAt: '2026-11-15T09:00:00.000Z' },
});

const setup = (
  query: Record<string, string> = {},
  answer: (input: ProcessDraftInput) => Promise<ProjectProcess> = async (input) => answered(input),
  options: Partial<Omit<EditorActionsOptions, 'ui' | 'editing' | 'navigate' | 'current'>> = {},
) => {
  const ui = createEditorUi();
  const puts: ProcessDraftInput[] = [];
  const client = {
    command: (async (_method: string, _path: string, body: object) => {
      puts.push(body as ProcessDraftInput);
      return answer(body as ProcessDraftInput);
    }) as never,
  };
  const editing = createEditing({ client, stored: () => PROCESS });
  const navigate = vi.fn<(url: string, options?: { replace?: boolean }) => void>();
  const actions = createEditorActions({ ui, editing, navigate, current: () => ({ params: { id: 'p1' }, query }), ...options });
  const shown = () => editing.definition('p1')!;
  return { ui, navigate, actions, editing, puts, shown };
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
      const { actions } = setup({}, undefined, { ideaTitle: (id) => (id === 'idea-1' ? 'Actualités' : null) });

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
      const { ui, actions } = setup({}, undefined, { client: { command } as never });
      actions.activate.confirmation({ revision: 4 }, stateOf({}));
      await actions.activate.run({ revision: 4 }, { seq: 41n });

      expect(command).toHaveBeenCalledWith('POST', '/api/projects/p1/process/activate', { revision: 4, seq: 41n }, expect.anything());
      expect(ui.view('p1', {}).toast).toEqual({ tone: 'go', icon: 'check', text: 'Version 4 active.' });
    });

    it('activates the Projet its confirmation named, even when the page moved to another one meanwhile', async () => {
      const command = vi.fn(async () => ({ id: 'p1', active: { ...VERSION_3, number: 4 }, draft: null, sources, running: [] }));
      let projectId = 'p1';
      const ui = createEditorUi();
      const editing = createEditing({ client: { command } as never, stored: () => undefined });
      const actions = createEditorActions({ ui, editing, navigate: vi.fn(), current: () => ({ params: { id: projectId }, query: {} }), client: { command } as never });

      expect(actions.activate.confirmation({ revision: 4 }, stateOf({})).title).toBe('Activer la v4 du Process de Site mairie ?');
      projectId = 'p2';
      await actions.activate.run({ revision: 4 }, { seq: 41n });

      expect(command).toHaveBeenCalledWith('POST', '/api/projects/p1/process/activate', { revision: 4, seq: 41n }, expect.anything());
      expect(command).toHaveBeenCalledTimes(1);
      expect(ui.view('p1', {}).toast).toEqual({ tone: 'go', icon: 'check', text: 'Version 4 active.' });
      expect(ui.view('p2', {}).toast).toBeNull();
    });

    it('sends nothing for a run its confirmation did not open', async () => {
      const command = vi.fn();
      const { actions } = setup({}, undefined, { client: { command } as never });
      await actions.activate.run({ revision: 4 }, { seq: 41n });
      expect(command).not.toHaveBeenCalled();
    });

    it('names a Rôle of the Pilote’s by its name in the list of changes', () => {
      const draft = structuredClone(PROCESS_CREWDECK);
      draft.steps.find((step) => step.id === 'st-maquettes')!.tools.push({ kind: 'role', roleId: 'r-abcdefgh' });
      const state = stateOf({ draft: draftOf(draft) });
      const settings = { customRoles: [{ id: 'r-abcdefgh', name: 'Designer' }] };
      const { actions } = setup();

      expect(actions.activate.confirmation({ revision: 4 }, { slices: { ...state.slices, settings } } as never).consequences.items).toEqual([
        { strong: '', text: 'Rôle « Designer » attaché à « Maquettes ».' },
      ]);
    });

    it('says a refusal in a halt Toast', async () => {
      const refusal = new ApiError({ status: 422, code: 'process.has-gaps', message: 'Ce brouillon a des Manques : règle-les avant de l’activer.' });
      const { ui, actions } = setup({}, undefined, { client: { command: vi.fn(async () => Promise.reject(refusal)) } as never });
      actions.activate.confirmation({ revision: 4 }, stateOf({}));
      await actions.activate.run({ revision: 4 }, { seq: 41n });

      expect(ui.view('p1', {}).toast).toEqual({ tone: 'halt', icon: 'block', text: 'Ce brouillon a des Manques : règle-les avant de l’activer.' });
    });
  });
});

describe('createMigrateAction', () => {
  const PROJECT = { id: 'p1', displayName: 'Site mairie', fullName: 'MaximeD1412/site-mairie', hasCode: true };
  const SINCE = '2026-11-01T08:00:00.000Z';
  const PROCESS = {
    id: 'p1',
    active: { number: 3, definition: PROCESS_CREWDECK },
    draft: null,
    sources: { ticket: { source: 'local', since: SINCE }, code: { source: 'github', since: SINCE } },
  };
  const state = { slices: { project: new Map([['p1', PROJECT]]), process: new Map([['p1', PROCESS]]), ticket: new Map([['t1', { projectId: 'p1' }]]) } } as unknown as StoreState;
  const setupMigrate = () => {
    const ui = createEditorUi();
    const command = vi.fn(async () => ({}) as never);
    const action = createMigrateAction({ ui, client: { command } as never, current: () => ({ params: { id: 'p1' }, query: { onglet: 'sources' } }) });
    return { ui, command, action };
  };

  it('asks to move the group from the Source it is on to the one picked', () => {
    const { action } = setupMigrate();
    const dialog = action.confirmation({ group: 'ticket', to: 'github' }, state);

    expect(dialog.title).toBe('Passer les Tickets de Site mairie sur GitHub ?');
    expect(dialog.consequences?.lead).toBe('Local → GitHub, MaximeD1412/site-mairie.');
  });

  it('shows the Source picked while it is asked, then puts the Select back once settled', () => {
    const { ui, action } = setupMigrate();
    const settled = action.pending?.({ group: 'ticket', to: 'github' });

    expect(ui.view('p1', { onglet: 'sources' }).choice).toEqual({ group: 'ticket', to: 'github' });
    settled?.();
    expect(ui.view('p1', { onglet: 'sources' }).choice).toBeNull();
  });

  it('sends the migration with the seq the Pilote confirmed on', async () => {
    const { command, action } = setupMigrate();
    await action.run({ group: 'ticket', to: 'github' }, { seq: 7n } as never);

    expect(command).toHaveBeenCalledWith('POST', '/api/projects/p1/sources/ticket/migrate', { to: 'github', seq: 7n }, expect.anything());
  });
});

describe('createEditorActions, editing (PROCESS-8)', () => {
  afterEach(() => vi.useRealTimers());

  it('opens the catalogue, adds the Étape chosen to the selected Phase, selects it and saves the draft once', async () => {
    const { actions, editing, navigate, puts, shown } = setup({ phase: 'ph-dev' });
    actions.openCatalogue();
    expect(editing.edits('p1').catalogue).toBe(true);
    actions.addStep({ kind: 'cross-review' });

    expect(editing.edits('p1').catalogue).toBe(false);
    expect(shown().steps.find((step) => step.id === 'st-cross-review')).toMatchObject({ phaseId: 'ph-dev', col: 5, row: 1 });
    expect(navigate).toHaveBeenCalledWith('/projets/p1/process?etape=st-cross-review', { replace: true });
    await editing.settled();
    expect(puts).toHaveLength(1);
    expect(editing.edits('p1').shown?.draft?.revision).toBe(1);
  });

  it('closes the catalogue', () => {
    const { actions, editing } = setup();
    actions.openCatalogue();
    actions.closeMenu();
    expect(editing.edits('p1').catalogue).toBe(false);
  });

  it('adds « Nouvelle Phase », selects it and focuses its name', () => {
    const { actions, editing, navigate, shown } = setup();
    actions.addPhase();
    expect(shown().phases.at(-1)).toMatchObject({ id: 'ph-1', name: 'Nouvelle Phase', row: 4 });
    expect(navigate).toHaveBeenCalledWith('/projets/p1/process?phase=ph-1', { replace: true });
    expect(editing.edits('p1').focusName).toEqual({ phaseId: 'ph-1', at: 1 });
  });

  it('moves a card to a free cell of another Phase, its arrows kept', () => {
    const { actions, shown } = setup();
    const arrows = shown().arrows.length;
    actions.moveStep({ stepId: 'st-rv', phaseId: 'ph-dev', col: 5, row: 1 });
    expect(shown().steps.find((step) => step.id === 'st-rv')).toMatchObject({ col: 5, row: 1 });
    expect(shown().arrows).toHaveLength(arrows);
  });

  it('says a refused move in the Toast, for 6 s or until the next edit, and changes nothing', () => {
    vi.useFakeTimers();
    const { actions, editing, puts, shown } = setup();
    actions.moveStepToPhase({ stepId: 'st-code', phaseId: 'ph-conception' });
    expect(editing.edits('p1').toast).toEqual({ tone: 'halt', text: 'Un Retour reste dans sa Phase : « Code » n’est pas dans « Développement »', arrow: null });
    expect(shown().steps.find((step) => step.id === 'st-code')?.phaseId).toBe('ph-dev');
    expect(puts).toHaveLength(0);
    vi.advanceTimersByTime(6000);
    expect(editing.edits('p1').toast).toBeNull();

    actions.moveStep({ stepId: 'st-code', phaseId: 'ph-dev', col: 2, row: 1 });
    expect(editing.edits('p1').toast?.text).toBe('Cette case est déjà prise par « Checks ».');
  });

  it('asks the Dialog before removing a Phase with Étapes: « Annuler » changes nothing, « Retirer la Phase » removes them in one save', async () => {
    const { actions, editing, navigate, puts, shown } = setup({ phase: 'ph-idee' });
    actions.removePhase({ phaseId: 'ph-idee' });
    expect(editing.edits('p1').removingPhase).toBe('ph-idee');
    actions.cancelRemovePhase();
    expect(editing.edits('p1').removingPhase).toBeNull();
    expect(shown().phases).toHaveLength(3);

    actions.removePhase({ phaseId: 'ph-idee' });
    actions.confirmRemovePhase({ phaseId: 'ph-idee' });
    expect(editing.edits('p1').removingPhase).toBeNull();
    expect(shown().phases.map((phase) => phase.id)).toEqual(['ph-conception', 'ph-dev']);
    expect(shown().steps.some((step) => step.phaseId === 'ph-idee')).toBe(false);
    expect(navigate).toHaveBeenLastCalledWith('/projets/p1/process', { replace: true });
    await editing.settled();
    expect(puts).toHaveLength(1);
  });

  it('removes a Phase without Étapes without the Dialog', () => {
    const { actions, editing, shown } = setup();
    actions.addPhase();
    actions.removePhase({ phaseId: 'ph-1' });
    expect(editing.edits('p1').removingPhase).toBeNull();
    expect(shown().phases).toHaveLength(3);
  });

  it('removes the selected Étape and clears the selection', () => {
    const { actions, navigate, shown } = setup({ etape: 'st-tri' });
    actions.removeStep({ stepId: 'st-tri' });
    expect(shown().steps.some((step) => step.id === 'st-tri')).toBe(false);
    expect(navigate).toHaveBeenLastCalledWith('/projets/p1/process', { replace: true });
  });

  it('refuses the name of another Phase under its field, until the next edit', () => {
    const { actions, editing, shown } = setup();
    actions.renamePhase({ phaseId: 'ph-dev', name: 'conception' });
    expect(editing.edits('p1').nameError).toEqual({ phaseId: 'ph-dev', text: 'Une Phase porte déjà ce nom.' });
    expect(editing.edits('p1').toast).toBeNull();
    actions.renamePhase({ phaseId: 'ph-dev', name: 'Livraison' });
    expect(editing.edits('p1').nameError).toBeNull();
    expect(shown().phases[2]?.name).toBe('Livraison');
  });

  it('sets what a Phase repeats for, a duplicate refused', () => {
    const { actions, editing, shown } = setup();
    actions.setForEach({ phaseId: 'ph-dev', forEach: null });
    expect(shown().phases[2]?.forEach).toBeNull();
    actions.setForEach({ phaseId: 'ph-idee', forEach: 'idea.retained' });
    expect(editing.edits('p1').toast?.text).toBe('« Conception » se répète pour chaque Idée retenue, comme « Idée »');
  });

  it('activates nothing when an edit was being saved under the confirmation, even if its save fails', async () => {
    let refuse: (error: unknown) => void = () => undefined;
    const posts: unknown[] = [];
    const { ui, actions, editing } = setup({}, () => new Promise((_resolve, reject) => (refuse = reject)), {
      client: { command: vi.fn(async (...args: unknown[]) => posts.push(args)) } as never,
    });
    actions.addPhase();
    expect(editing.edits('p1').saving).toBe(true);
    actions.activate.confirmation({ revision: 0 }, stateOf({}));

    const running = actions.activate.run({ revision: 0 }, { seq: 41n });
    refuse(new ApiError({ status: 500, code: 'server.internal', message: 'Erreur.' }));
    await running;

    expect(editing.edits('p1').saving).toBe(false);
    expect(posts).toEqual([]);
    expect(ui.view('p1', {}).toast).toEqual({ tone: 'halt', icon: 'block', text: 'Le brouillon s’enregistrait pendant la confirmation : relis-le, puis active.' });
  });

  it('says a draft another tab saved first, and shows the store’s again', async () => {
    const { actions, editing, shown } = setup({}, async () => {
      throw new ApiError({ status: 409, code: 'process.draft-stale', message: 'Brouillon périmé.' });
    });
    actions.addPhase();
    await editing.settled();
    expect(editing.edits('p1').toast?.text).toBe('Le brouillon a changé dans un autre onglet : ton dernier changement n’est pas enregistré.');
    expect(shown().phases).toHaveLength(3);
  });
});

describe('createEditorActions, arrows, Retours and Outils (PROCESS-9)', () => {
  afterEach(() => vi.useRealTimers());
  const port = (stepId: string, portId: string) => ({ stepId, portId });
  const holds = (definition: ProcessDefinition, from: string, to: string) =>
    definition.arrows.some((arrow) => `${arrow.from.stepId}.${arrow.from.portId}` === from && `${arrow.to.stepId}.${arrow.to.portId}` === to);

  it('refuses an arrow between two types: drawn refused with « Refusée : … » for 6 s or until the next edit, nothing saved', async () => {
    vi.useFakeTimers();
    const { actions, editing, puts, shown } = setup();
    const arrows = shown().arrows.length;
    actions.connect({ from: port('st-code', 'changement'), to: port('st-rv', 'maquettes') });

    expect(editing.edits('p1').toast).toEqual({
      tone: 'halt',
      text: 'Refusée : une Sortie Changement de code ne va que vers une Entrée Changement de code',
      arrow: { from: port('st-code', 'changement'), to: port('st-rv', 'maquettes') },
    });
    expect(shown().arrows).toHaveLength(arrows);
    await editing.settled();
    expect(puts).toHaveLength(0);
    vi.advanceTimersByTime(6000);
    expect(editing.edits('p1').toast).toBeNull();
  });

  it('adds an accepted arrow and saves the draft; an Entrée already fed or a cycle refused with its label', async () => {
    const { actions, editing, puts, shown } = setup();
    actions.disconnect({ from: port('st-checks', 'verdict'), to: port('st-review', 'verdict') });
    actions.connect({ from: port('st-checks', 'verdict'), to: port('st-review', 'verdict') });
    expect(holds(shown(), 'st-checks.verdict', 'st-review.verdict')).toBe(true);
    await editing.settled();
    expect(puts.length).toBeGreaterThan(0);

    actions.connect({ from: port('st-rv', 'verdict'), to: port('st-review', 'verdict') });
    expect(editing.edits('p1').toast?.text).toBe('Refusée : l’Entrée « Verdict des checks » de « Review » a déjà sa flèche');
    actions.connect({ from: port('st-merge', 'changement'), to: port('st-checks', 'changement') });
    expect(editing.edits('p1').toast?.text).toMatch(/^Refusée : /);
  });

  it('draws a Retour from the Review to « Code » with « 3 fois au plus », sets its maximum, removes it; refuses one from an Étape that does not judge', () => {
    const { actions, editing, shown } = setup();
    actions.removeLoopBack({ from: 'st-review' });
    expect(shown().loopBacks.some((loop) => loop.from === 'st-review')).toBe(false);

    actions.addLoopBack({ from: 'st-review', to: 'st-code' });
    expect(shown().loopBacks.find((loop) => loop.from === 'st-review')).toEqual({ from: 'st-review', to: 'st-code', max: 3 });
    expect(editing.edits('p1').toast).toEqual({ tone: 'accent', text: 'Retour de « Review » vers « Code », 3 fois au plus.', arrow: null });

    actions.setLoopBackMax({ from: 'st-review', max: 10 });
    expect(shown().loopBacks.find((loop) => loop.from === 'st-review')?.max).toBe(10);
    actions.setLoopBackMax({ from: 'st-review', max: 11 });
    expect(editing.edits('p1').toast?.text).toBe('Un Retour se prend de 1 à 10 fois.');

    actions.addLoopBack({ from: 'st-checks', to: 'st-code' });
    expect(editing.edits('p1').toast?.text).toBe('Refusée : « Checks » ne juge pas : un Retour part d’une Étape qui juge');
  });

  it('opens « Attacher un Outil » (closing the catalogue), attaches the Outil chosen and closes it', () => {
    const { actions, editing, shown } = setup({}, undefined, { repository: () => 'MaximeD1412/site-mairie' });
    actions.openCatalogue();
    actions.openAttach({ stepId: 'st-review' });
    expect(editing.edits('p1')).toMatchObject({ attach: 'st-review', catalogue: false });

    actions.attachTool({ stepId: 'st-review', tool: { kind: 'mcp', name: 'stitch' } });
    expect(editing.edits('p1').attach).toBeNull();
    expect(shown().steps.find((step) => step.id === 'st-review')?.tools).toContainEqual({ kind: 'mcp', name: 'stitch' });

    actions.attachTool({ stepId: 'st-review', tool: { kind: 'connector', connector: 'github' } });
    expect(shown().steps.find((step) => step.id === 'st-review')?.tools).toContainEqual({ kind: 'connector', connector: 'github' });

    actions.detachTool({ stepId: 'st-review', tool: { kind: 'mcp', name: 'stitch' } });
    expect(shown().steps.find((step) => step.id === 'st-review')?.tools).not.toContainEqual({ kind: 'mcp', name: 'stitch' });

    actions.openAttach({ stepId: 'st-review' });
    actions.closeMenu();
    expect(editing.edits('p1').attach).toBeNull();
  });

  it('refuses GitHub for a Projet without repository', () => {
    const { actions, editing } = setup();
    actions.attachTool({ stepId: 'st-review', tool: { kind: 'connector', connector: 'github' } });
    expect(editing.edits('p1').toast?.text).toBe('Le Connecteur GitHub demande un Dépôt GitHub : ce Projet n’en a pas.');
  });

  it('leads « Déclarer un Serveur MCP » to the Runner’s page, the Menu closed', () => {
    const { actions, editing, navigate } = setup();
    actions.openAttach({ stepId: 'st-review' });
    actions.openRunner();
    expect(navigate).toHaveBeenCalledWith('/runner');
    expect(editing.edits('p1').attach).toBeNull();
  });
});
