import { createEditorActions } from './process-editor.js';
import { createEditorUi } from '../process/editor-ui.js';

const setup = (query: Record<string, string> = {}) => {
  const ui = createEditorUi();
  const navigate = vi.fn<(url: string, options?: { replace?: boolean }) => void>();
  const actions = createEditorActions({ ui, navigate, current: () => ({ params: { id: 'p1' }, query }) });
  return { ui, navigate, actions };
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
