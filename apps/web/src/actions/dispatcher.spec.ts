import { defineComposant, emitAction, sensitive, t } from '@crewdeck/sdk';
import { z } from 'zod';
import type { StoreState } from '../store/store.js';
import { createDispatcher, type SensitiveConfirmation } from './dispatcher.js';

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

const Porte = defineComposant({
  name: 'Porte',
  version: 1,
  tag: 'cd-porte-dispatch',
  category: 'partie',
  description: 'Une porte de test.',
  data: z.object({}),
  actions: { merge: sensitive('merge', z.object({ id: z.string() })), peek: z.object({}) },
  slots: [],
  examples: [{ name: 'nominal', data: {} }],
});

describe('the dispatcher, for an Action sensible', () => {
  const live: StoreState = { seq: 7n, connection: 'live', lostAt: null, slices: {} };
  let state: StoreState;
  let answer: (confirmed: boolean) => void;
  const confirm = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  );
  const announce = vi.fn();
  const run = vi.fn();
  const confirmation: SensitiveConfirmation<{ id: string }> = (payload) => ({
    title: `Merger ${payload.id} ?`,
    confirmLabel: 'Merger',
    icon: 'merge',
    consequences: { lead: 'Le Ticket part sur develop.' },
  });
  let dispatcher: ReturnType<typeof createDispatcher>;
  let stop: () => void;

  const emit = () => {
    const host = document.createElement('div');
    document.body.append(host);
    emitAction(host, Porte, 'merge', { id: '#12' });
  };

  beforeEach(() => {
    state = live;
    confirm.mockClear();
    announce.mockClear();
    run.mockClear();
    dispatcher = createDispatcher({ declarations: { Porte }, state: () => state, confirm, announce });
    dispatcher.registerAction(Porte, 'merge', { run, confirmation });
    stop = dispatcher.listen(document);
  });

  afterEach(() => {
    stop();
    document.body.replaceChildren();
  });

  it('opens the confirmation with what the action declares, and runs nothing on « Annuler »', async () => {
    emit();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      action: 'merge',
      title: 'Merger #12 ?',
      confirmLabel: 'Merger',
      icon: 'merge',
      consequences: { lead: 'Le Ticket part sur develop.' },
    });
    answer(false);
    await vi.waitFor(() => expect(confirm.mock.results[0]?.value).resolves.toBe(false));
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the handler once on confirm, with the seq captured when the dialog opened', async () => {
    emit();
    state = { ...live, seq: 9n };
    answer(true);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith({ id: '#12' }, { seq: 7n });
  });

  it('during the Resynchronisation, opens no dialog, runs nothing and announces why', () => {
    state = { ...live, connection: 'resync' };
    emit();
    expect(confirm).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(t('resync.sensitiveUnavailable'));
  });

  it('runs nothing when the Resynchronisation starts while the Pilote confirms, and announces why', async () => {
    emit();
    state = { ...live, connection: 'resync' };
    answer(true);
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith(t('resync.sensitiveUnavailable')));
    expect(run).not.toHaveBeenCalled();
  });

  it('opens one confirmation at a time', () => {
    emit();
    emit();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('refuses at registration an Action sensible without its confirmation', () => {
    const other = createDispatcher({ declarations: { Porte } });
    // @ts-expect-error: the types already ask for it; the boot checks it for plain JavaScript too.
    expect(() => other.registerAction(Porte, 'merge', { run })).toThrow(/Porte\.merge.*confirmation/);
  });

  it('runs a free action of the same Composant at once, without a dialog', () => {
    const peek = vi.fn();
    dispatcher.registerAction(Porte, 'peek', { run: peek });
    emitAction(document.body, Porte, 'peek', {});
    expect(peek).toHaveBeenCalledWith({});
    expect(confirm).not.toHaveBeenCalled();
  });
});
