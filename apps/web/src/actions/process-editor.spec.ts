import { PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, type ProcessDraftInput, type ProjectProcess } from '@crewdeck/contracts';
import { ApiError } from '../api/request.js';
import { createEditing } from '../process/editing.js';
import { createEditorActions } from './process-editor.js';
import { createEditorUi } from '../process/editor-ui.js';

const PROCESS: ProjectProcess = {
  id: 'p1',
  active: { number: 1, definition: PROCESS_CREWDECK, sealed: null, activatedAt: '2026-11-15T08:00:00.000Z', activatedBy: 'creation', templateName: PROCESS_CREWDECK_NAME },
  draft: null,
  sources: { ticket: { source: 'github', since: '2026-11-15T08:00:00.000Z' }, code: { source: 'github', since: '2026-11-15T08:00:00.000Z' } },
};

const answered = (input: ProcessDraftInput): ProjectProcess => ({
  ...PROCESS,
  draft: { definition: input.definition, sealed: input.sealed, revision: input.revision + 1, baseVersion: input.baseVersion, updatedAt: '2026-11-15T09:00:00.000Z' },
});

const setup = (query: Record<string, string> = {}, answer: (input: ProcessDraftInput) => Promise<ProjectProcess> = async (input) => answered(input)) => {
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
  const actions = createEditorActions({ ui, editing, navigate, current: () => ({ params: { id: 'p1' }, query }) });
  const shown = () => editing.definition('p1')!;
  return { ui, navigate, actions, editing, puts, shown };
};

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
    expect(editing.edits('p1').toast).toBe('Un Retour reste dans sa Phase : « Code » n’est pas dans « Développement »');
    expect(shown().steps.find((step) => step.id === 'st-code')?.phaseId).toBe('ph-dev');
    expect(puts).toHaveLength(0);
    vi.advanceTimersByTime(6000);
    expect(editing.edits('p1').toast).toBeNull();

    actions.moveStep({ stepId: 'st-code', phaseId: 'ph-dev', col: 2, row: 1 });
    expect(editing.edits('p1').toast).toBe('Cette case est déjà prise par « Checks ».');
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
    expect(editing.edits('p1').toast).toBe('« Conception » se répète pour chaque Idée retenue, comme « Idée »');
  });

  it('says a draft another tab saved first, and shows the store’s again', async () => {
    const { actions, editing, shown } = setup({}, async () => {
      throw new ApiError({ status: 409, code: 'process.draft-stale', message: 'Brouillon périmé.' });
    });
    actions.addPhase();
    await editing.settled();
    expect(editing.edits('p1').toast).toBe('Le brouillon a changé dans un autre onglet : ton dernier changement n’est pas enregistré.');
    expect(shown().phases).toHaveLength(3);
  });
});
