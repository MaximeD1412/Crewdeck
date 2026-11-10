import { defineComposant, emitAction } from '@crewdeck/sdk';
import { z } from 'zod';
import { createDispatcher } from './dispatcher.js';

const Ligne = defineComposant({
  name: 'Ligne',
  version: 1,
  tag: 'cd-ligne-dispatch',
  category: 'partie',
  description: 'Une ligne de test.',
  data: z.object({}),
  actions: { open: z.object({ id: z.string() }), close: z.object({}) },
  slots: [],
  examples: [{ name: 'nominal', data: {} }],
});

describe('the cd-action dispatcher', () => {
  let stop: () => void;
  let warn: ReturnType<typeof vi.spyOn>;
  const run = vi.fn();
  const dispatcher = createDispatcher({ declarations: { Ligne } });
  dispatcher.registerAction(Ligne, 'open', { run });

  /** An element in a shadow root, as a Composant inside a page. */
  const emitter = () => {
    const host = document.createElement('div');
    document.body.append(host);
    const inner = document.createElement('button');
    host.attachShadow({ mode: 'open' }).append(inner);
    return inner;
  };

  const dispatch = (detail: unknown) =>
    emitter().dispatchEvent(new CustomEvent('cd-action', { bubbles: true, composed: true, detail }));

  beforeEach(() => {
    run.mockClear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stop = dispatcher.listen(document);
  });

  afterEach(() => {
    stop();
    warn.mockRestore();
    document.body.replaceChildren();
  });

  it('runs the handler once with the validated payload of an action from a shadow root', () => {
    emitAction(emitter(), Ligne, 'open', { id: '42' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ id: '42' });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid payload', { composant: 'Ligne', action: 'open', payload: { id: 42 } }],
    ['an unknown action', { composant: 'Ligne', action: 'delete', payload: { id: '42' } }],
    ['an unknown Composant', { composant: 'Fantome', action: 'open', payload: { id: '42' } }],
    ['an action without a handler', { composant: 'Ligne', action: 'close', payload: {} }],
    ['a malformed detail', 'open'],
  ])('runs nothing for %s, with a warning', (_case, detail) => {
    dispatch(detail);
    expect(run).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stops listening', () => {
    stop();
    emitAction(emitter(), Ligne, 'open', { id: '42' });
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a second handler for the same action', () => {
    expect(() => dispatcher.registerAction(Ligne, 'open', { run })).toThrow(/Ligne.*open/);
  });
});
