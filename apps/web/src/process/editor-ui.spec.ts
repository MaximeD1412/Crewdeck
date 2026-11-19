import { createEditorUi, editorQueryOf, processHref } from './editor-ui.js';

describe('editorQueryOf', () => {
  it('opens on « Manques » with nothing selected by default', () => {
    expect(editorQueryOf({})).toEqual({ selection: null, tab: 'gaps' });
  });

  it('reads the Étape or the Phase selected, on their tab unless another is asked', () => {
    expect(editorQueryOf({ etape: 'st-review' })).toEqual({ selection: { kind: 'step', id: 'st-review' }, tab: 'selection' });
    expect(editorQueryOf({ phase: 'ph-dev' })).toEqual({ selection: { kind: 'phase', id: 'ph-dev' }, tab: 'selection' });
    expect(editorQueryOf({ etape: 'st-review', onglet: 'manques' })).toEqual({ selection: { kind: 'step', id: 'st-review' }, tab: 'gaps' });
    expect(editorQueryOf({ onglet: 'sources' })).toEqual({ selection: null, tab: 'sources' });
    expect(editorQueryOf({ onglet: 'etape' })).toEqual({ selection: null, tab: 'selection' });
  });

  it('ignores a tab it does not know', () => {
    expect(editorQueryOf({ onglet: 'diff' })).toEqual({ selection: null, tab: 'gaps' });
  });
});

describe('processHref', () => {
  it('writes the selection and a tab other than its default', () => {
    expect(processHref('p1', { selection: null, tab: 'gaps' })).toBe('/projets/p1/process');
    expect(processHref('p1', { selection: { kind: 'step', id: 'st-review' }, tab: 'selection' })).toBe('/projets/p1/process?etape=st-review');
    expect(processHref('p1', { selection: { kind: 'phase', id: 'ph-dev' }, tab: 'gaps' })).toBe('/projets/p1/process?phase=ph-dev&onglet=manques');
    expect(processHref('p1', { selection: null, tab: 'sources' })).toBe('/projets/p1/process?onglet=sources');
    expect(processHref('p 1', { selection: null, tab: 'selection' })).toBe('/projets/p%201/process?onglet=etape');
  });

  it('reads back what it writes', () => {
    const state = { selection: { kind: 'phase', id: 'ph-dev' }, tab: 'sources' } as const;
    const url = new URL(processHref('p1', state), 'http://crewdeck.invalid');
    expect(editorQueryOf(Object.fromEntries(url.searchParams))).toEqual(state);
  });
});

describe('createEditorUi', () => {
  it('opens each Projet at 90 %, from the top left corner, centred on the block of its URL', () => {
    const ui = createEditorUi();
    expect(ui.view('p1', { etape: 'st-review' })).toEqual({
      selection: { kind: 'step', id: 'st-review' },
      tab: 'selection',
      zoom: 90,
      pan: { x: 0, y: 0 },
      focus: { id: 'st-review', at: 0 },
    });
    expect(ui.view('p2', {}).focus).toBeNull();
  });

  it('keeps the view of each Projet while the tab lives', () => {
    const ui = createEditorUi();
    ui.view('p1', {});
    ui.setView('p1', { zoom: 120, pan: { x: 40, y: -10 } });

    expect(ui.view('p1', {})).toMatchObject({ zoom: 120, pan: { x: 40, y: -10 } });
    expect(ui.view('p2', {})).toMatchObject({ zoom: 90, pan: { x: 0, y: 0 } });
  });

  it('asks to centre a block again each time it is chosen', () => {
    const ui = createEditorUi();
    ui.view('p1', { etape: 'st-review' });
    ui.centre('p1', 'st-merge');
    expect(ui.view('p1', { etape: 'st-merge' }).focus).toEqual({ id: 'st-merge', at: 1 });
    ui.centre('p1', 'st-merge');
    expect(ui.view('p1', { etape: 'st-merge' }).focus).toEqual({ id: 'st-merge', at: 2 });
  });

  it('centres a block once: back on the page after a move, the canvas keeps the view it was left at', () => {
    const ui = createEditorUi();
    expect(ui.view('p1', { etape: 'st-review' }).focus).toEqual({ id: 'st-review', at: 0 });
    ui.setView('p1', { zoom: 90, pan: { x: 300, y: 120 } }); // the canvas, once Review centred
    ui.setView('p1', { zoom: 90, pan: { x: 500, y: 40 } }); // the Pilote's move

    expect(ui.view('p1', { etape: 'st-review' })).toMatchObject({ pan: { x: 500, y: 40 }, focus: null });
    ui.centre('p1', 'st-review');
    expect(ui.view('p1', { etape: 'st-review' }).focus).toEqual({ id: 'st-review', at: 1 });
  });

  it('tells its listeners when the view changes', () => {
    const ui = createEditorUi();
    const listener = vi.fn();
    const stop = ui.subscribe(listener);
    ui.setView('p1', { zoom: 80, pan: { x: 0, y: 0 } });
    ui.centre('p1', 'st-code');
    stop();
    ui.setView('p1', { zoom: 70, pan: { x: 0, y: 0 } });

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
