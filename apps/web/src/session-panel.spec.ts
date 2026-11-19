import type { AgentSession, EngineEvent, Project, Runner } from '@crewdeck/contracts';
import { Button, Composer, Empty, Message, Session, t } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { fakeSpeech, installFakeSpeech, removeSpeech } from './dictation/fake-speech.js';
import { createSessionPanel, type SessionPanelOptions } from './session-panel.js';
import { SessionInputError, type SessionRelay, type SessionSubscription } from './sessions/relay.js';
import type { SessionRelayError } from '@crewdeck/contracts';
import type { StoreState } from './store/store.js';

type WithData = HTMLElement & { data: unknown };

const NOW = new Date('2026-11-11T14:05:00.000Z');
const PROJECT_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02';
const SESSION: AgentSession = {
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a7b',
  projectId: PROJECT_ID,
  role: 'design',
  engine: 'claude-code',
  model: 'claude-opus-5-5',
  title: 'Concevoir · Agenda partagé',
  state: 'active',
  interruptedReason: null,
  outcome: null,
  error: null,
  stepRunId: null,
  branch: 'design/agenda-partage',
  startedAt: '2026-11-11T14:00:00.000Z',
  endedAt: null,
};
const PROJECT = { id: PROJECT_ID, displayName: 'Personal OS' } as Project;
const ONLINE = { state: 'online', lastSeenAt: '2026-11-11T14:04:58.000Z' } as Runner;
const OFFLINE = { state: 'offline', lastSeenAt: '2026-11-11T14:02:00.000Z' } as Runner;
const agent = (seq: number, text: string): EngineEvent => ({ kind: 'message', seq, at: '2026-11-11T14:04:23.000Z', from: 'agent', text, final: true });

/** A store holding the slices the panel reads; `set` changes them and tells the listeners. */
const fakeStore = (session: AgentSession | null, runner: Runner = ONLINE) => {
  const listeners = new Set<(state: StoreState) => void>();
  let state = {
    seq: 1n,
    connection: 'live',
    lostAt: null,
    vaultState: 'unlocked',
    slices: {
      project: new Map([[PROJECT_ID, PROJECT]]),
      runner,
      settings: null,
      'agent-session': new Map(session ? [[session.id, session]] : []),
    },
  } as unknown as StoreState;
  return {
    getState: () => state,
    subscribe(fn: (state: StoreState) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(slices: Partial<StoreState['slices']>) {
      state = { ...state, slices: { ...state.slices, ...slices } };
      for (const fn of listeners) fn(state);
    },
    setVault(vaultState: StoreState['vaultState']) {
      state = { ...state, vaultState };
      for (const fn of listeners) fn(state);
    },
    listeners,
  };
};

/** A relay whose followed Session gets its events and its refusal from the test. */
const fakeRelay = () => {
  const listeners = new Set<() => void>();
  let events: EngineEvent[] = [];
  let error: SessionRelayError | null = null;
  const subscription: SessionSubscription = {
    sessionId: SESSION.id,
    events: () => events,
    error: () => error,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const relay = {
    openSession: vi.fn<SessionRelay['openSession']>(() => subscription),
    closeSession: vi.fn<SessionRelay['closeSession']>(),
    sendInput: vi.fn<SessionRelay['sendInput']>(async () => 'input-1'),
  };
  return {
    relay,
    push(...more: EngineEvent[]) {
      events = [...events, ...more];
      for (const listener of listeners) listener();
    },
    refuse(code: SessionRelayError) {
      error = code;
      for (const listener of listeners) listener();
    },
  };
};

const notFound = new ApiError({ status: 404, code: 'sessions.not-found', message: 'Session introuvable.' } as never);

interface Setup {
  readonly session?: AgentSession | null;
  readonly runner?: Runner;
  readonly query?: Client['query'];
  readonly command?: Client['command'];
}

const setup = ({ session = SESSION, runner = ONLINE, query = vi.fn() as unknown as Client['query'], command = vi.fn() as unknown as Client['command'] }: Setup = {}) => {
  const store = fakeStore(session, runner);
  const relay = fakeRelay();
  const panels: (HTMLElement | null)[] = [];
  const shell = { setPanel: vi.fn((element: HTMLElement | null) => panels.push(element)), showError: vi.fn<(message: string) => void>() };
  const navigate = vi.fn<(url: string) => void>();
  const close = vi.fn<() => void>();
  const options: SessionPanelOptions = {
    store,
    client: { query, command } as Pick<Client, 'query' | 'command'>,
    relay: relay.relay,
    shell,
    navigate,
    close,
    now: () => NOW,
    readyTimeout: 1000,
  };
  const panel = createSessionPanel(options);
  const shown = () => panels.at(-1) as WithData | null | undefined;
  return { store, relay, shell, navigate, close, panel, shown, query, command };
};

const stream = (element: Element) => [...element.children].filter((child) => !child.hasAttribute('slot'));
const textsOf = (element: Element) => stream(element).map((child) => (child as WithData).data as { text?: string; title?: string });

afterEach(() => vi.useRealTimers());

describe('the Session panel', () => {
  it('opens the Session of `?session=` from the store, follows its relay and shows its events as they come', () => {
    const { panel, shown, relay } = setup();
    panel.show(SESSION.id);

    const element = shown() as WithData;
    expect(element.localName).toBe(Session.tag);
    expect(element.data).toMatchObject({ id: SESSION.id, title: SESSION.title, state: 'active', meta: 'Personal OS · Conception · Claude Code' });
    expect(relay.relay.openSession).toHaveBeenCalledWith(SESSION.id);

    relay.push(agent(1, 'Je regarde le PRD.'));
    expect(shown()).toBe(element);
    expect(stream(element).map((child) => child.localName)).toEqual([Message.tag]);
    expect(textsOf(element)).toMatchObject([{ text: 'Je regarde le PRD.' }]);
  });

  it('closes: no panel, the relay closed, its listeners gone', () => {
    const { panel, shown, relay, store } = setup();
    panel.show(SESSION.id);
    panel.show(null);
    expect(shown()).toBeNull();
    expect(relay.relay.closeSession).toHaveBeenCalledWith(SESSION.id);
    store.set({});
    expect(shown()).toBeNull();
  });

  it('a Session not in the store: read by its id; another’s or none shows « Session introuvable », whose « Fermer » closes', async () => {
    const query = vi.fn(async () => {
      throw notFound;
    }) as unknown as Client['query'];
    const { panel, shown, close, relay } = setup({ session: null, query });
    panel.show(SESSION.id);
    await vi.waitFor(() => expect(shown()?.localName).toBe(Empty.tag));

    expect(query).toHaveBeenCalledWith(`/api/sessions/${SESSION.id}`, expect.anything());
    expect(relay.relay.openSession).not.toHaveBeenCalled();
    const element = shown() as WithData;
    expect(element.data).toMatchObject({ title: t('session.notFound.title') });
    (element.querySelector(Button.tag) as HTMLElement).click();
    expect(close).toHaveBeenCalled();
  });

  it('a Session ended beyond the store’s 24 h: read by its id, then shown', async () => {
    const ended = { ...SESSION, state: 'ended', endedAt: '2026-11-09T10:00:00.000Z' } as const;
    const query = vi.fn(async () => ended) as unknown as Client['query'];
    const { panel, shown } = setup({ session: null, query });
    panel.show(SESSION.id);
    await vi.waitFor(() => expect(shown()?.localName).toBe(Session.tag));
    expect(shown()?.data).toMatchObject({ state: 'stopped', resumeDisabledReason: t('session.resumeDisabled.ended') });
  });

  it('the relay refusing the Session (another Pilote’s) shows « Session introuvable »', () => {
    const { panel, shown, relay } = setup();
    panel.show(SESSION.id);
    relay.refuse('session.not-found');
    expect(shown()?.localName).toBe(Empty.tag);
  });

  it('the Runner offline: the relay closed, only the title and state, « Voir le Runner » to /runner; back online, followed again', () => {
    const { panel, shown, relay, store, navigate } = setup();
    panel.show(SESSION.id);
    relay.push(agent(1, 'Je regarde le PRD.'));
    store.set({ runner: OFFLINE });

    expect(relay.relay.closeSession).toHaveBeenCalledWith(SESSION.id);
    const element = shown() as WithData;
    expect(element.data).toMatchObject({ title: SESSION.title, resumeDisabledReason: t('session.resumeDisabled.offline') });
    expect(element.textContent).not.toContain('PRD');
    (element.querySelector(`${Empty.tag} > ${Button.tag}`) as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith('/runner');

    store.set({ runner: ONLINE });
    expect(relay.relay.openSession).toHaveBeenCalledTimes(2);
  });

  it('the Runner offline: a fresh Composer in place of the one typed in, so no draft stays in the page', () => {
    const { panel, shown, store } = setup();
    panel.show(SESSION.id);
    const typedIn = (shown() as Element).querySelector('cd-composer');
    expect(typedIn).not.toBeNull();
    store.set({ runner: OFFLINE });
    const offline = (shown() as Element).querySelector('cd-composer');
    expect(offline).not.toBeNull();
    expect(offline).not.toBe(typedIn);
    expect(typedIn?.isConnected).toBe(false);
  });

  it('the Appareil approved while the panel is open: the relay opened again for its keys and replay, then read and written to', async () => {
    const { store, relay, panel, shown } = setup();
    store.setVault('no-device');
    panel.show(SESSION.id);
    // Not approved yet: the relay dropped the Session's keys, nothing to read.
    expect(relay.relay.openSession).toHaveBeenCalledTimes(1);
    store.set({});
    expect(relay.relay.openSession).toHaveBeenCalledTimes(1);

    store.setVault('unlocked');
    expect(relay.relay.closeSession).toHaveBeenCalledWith(SESSION.id);
    expect(relay.relay.openSession).toHaveBeenCalledTimes(2);
    relay.push(agent(1, 'Les nuages flottent.'));
    expect(textsOf(shown() as WithData).map((data) => data.text)).toEqual(['Les nuages flottent.']);
    await panel.send('Merci.');
    expect(relay.relay.sendInput).toHaveBeenCalledWith(SESSION.id, { kind: 'message', text: 'Merci.' });
    // Opened once more only by another approval, not by any change of the store.
    store.set({});
    expect(relay.relay.openSession).toHaveBeenCalledTimes(2);
  });

  it('« Arrêter » and « Reprendre » post to the Session’s routes', async () => {
    const command = vi.fn(async () => SESSION) as unknown as Client['command'];
    const { panel } = setup({ command });
    panel.show(SESSION.id);
    await panel.stop();
    await panel.resume();
    expect(command).toHaveBeenNthCalledWith(1, 'POST', `/api/sessions/${SESSION.id}/stop`, {}, expect.anything());
    expect(command).toHaveBeenNthCalledWith(2, 'POST', `/api/sessions/${SESSION.id}/resume`, {}, expect.anything());
  });

  it('writing to a running Session: the input sealed through the relay, the Pilote’s message after the last event', async () => {
    const { panel, shown, relay } = setup();
    panel.show(SESSION.id);
    relay.push(agent(1, 'Je regarde le PRD.'));
    await panel.send('Pense aux événements récurrents.');
    relay.push(agent(2, 'Noté.'));

    expect(relay.relay.sendInput).toHaveBeenCalledWith(SESSION.id, { kind: 'message', text: 'Pense aux événements récurrents.' });
    expect(textsOf(shown() as Element).map((data) => data.text)).toEqual(['Je regarde le PRD.', 'Pense aux événements récurrents.', 'Noté.']);
  });

  it('writing to a stopped Session resumes it, then sends once it runs again', async () => {
    const stopped = { ...SESSION, state: 'stopped', endedAt: '2026-11-11T14:03:00.000Z' } as const;
    const command = vi.fn(async () => ({ ...stopped, state: 'starting', endedAt: null })) as unknown as Client['command'];
    const { panel, relay, store } = setup({ session: stopped, command });
    panel.show(SESSION.id);

    const sent = panel.send('Reprends.');
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('POST', `/api/sessions/${SESSION.id}/resume`, {}, expect.anything()));
    expect(relay.relay.sendInput).not.toHaveBeenCalled();
    store.set({ 'agent-session': new Map([[SESSION.id, { ...SESSION, state: 'active' }]]) });
    await sent;
    expect(relay.relay.sendInput).toHaveBeenCalledWith(SESSION.id, { kind: 'message', text: 'Reprends.' });
  });

  it('a Session that does not run again in time: nothing sent, and why', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stopped = { ...SESSION, state: 'stopped', endedAt: '2026-11-11T14:03:00.000Z' } as const;
    const command = vi.fn(async () => stopped) as unknown as Client['command'];
    const { panel, relay, shell } = setup({ session: stopped, command });
    panel.show(SESSION.id);
    const sent = panel.send('Reprends.');
    await vi.advanceTimersByTimeAsync(1000);
    await sent;
    expect(relay.relay.sendInput).not.toHaveBeenCalled();
    expect(shell.showError).toHaveBeenCalledWith(t('session.send.notResumed'));
  });

  it('an input the relay cannot send: why, and no message shown', async () => {
    const { panel, relay, shell, shown } = setup();
    panel.show(SESSION.id);
    relay.relay.sendInput.mockRejectedValueOnce(new SessionInputError('no-key'));
    await panel.send('Bonjour');
    relay.relay.sendInput.mockRejectedValueOnce(new SessionInputError('too-large'));
    await panel.send('x'.repeat(10));
    expect(shell.showError.mock.calls).toEqual([[t('session.send.failed')], [t('session.send.tooLarge')]]);
    expect(stream(shown() as Element)).toEqual([]);
  });

  it('« <Moteur> travaille » counts the seconds while it runs', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let now = NOW;
    const store = fakeStore(SESSION);
    const panels: (HTMLElement | null)[] = [];
    const panel = createSessionPanel({
      store,
      client: { query: vi.fn(), command: vi.fn() } as unknown as Pick<Client, 'query' | 'command'>,
      relay: fakeRelay().relay,
      shell: { setPanel: (element) => panels.push(element), showError: vi.fn() },
      navigate: vi.fn(),
      close: vi.fn(),
      now: () => now,
    });
    panel.show(SESSION.id);
    const element = panels.at(-1) as WithData;
    expect(element.data).toMatchObject({ status: 'Claude Code travaille · 5 min' });
    now = new Date(NOW.getTime() + 60_000);
    vi.advanceTimersByTime(1000);
    expect(element.data).toMatchObject({ status: 'Claude Code travaille · 6 min' });
    panel.show(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('dictated', () => {
    const composerOf = (element: Element | null | undefined) =>
      (element?.querySelector(`:scope > ${Composer.tag}`) as WithData | null)?.data as { value: string; dictation: { available: boolean; state: string; error: string | null } } | undefined;

    beforeEach(() => {
      installFakeSpeech();
      localStorage.clear();
    });
    afterEach(() => removeSpeech());

    it('the Composer’s transcript fills its field and is never sent; « Arrêter la dictée » keeps it', () => {
      const { panel, shown, relay } = setup();
      panel.show(SESSION.id);
      expect(composerOf(shown())?.dictation).toMatchObject({ available: true, state: 'idle' });
      panel.dictateStart('Regarde');
      expect(composerOf(shown())?.dictation).toMatchObject({ state: 'dictating' });
      fakeSpeech().say('les événements récurrents', false);
      expect(composerOf(shown())?.value).toBe('Regarde les événements récurrents');
      fakeSpeech().say('les événements récurrents', true);
      panel.dictateStop();
      expect(composerOf(shown())).toMatchObject({ value: 'Regarde les événements récurrents', dictation: { state: 'idle' } });
      expect(relay.relay.sendInput).not.toHaveBeenCalled();
    });

    it('sending stops the dictation and empties the field the core set', async () => {
      const { panel, shown, relay } = setup();
      panel.show(SESSION.id);
      panel.dictateStart('');
      fakeSpeech().say('Pense aux récurrents', false);
      await panel.send('Pense aux récurrents');
      expect(fakeSpeech().listening).toBe(false);
      expect(relay.relay.sendInput).toHaveBeenCalledTimes(1);
      expect(composerOf(shown())).toMatchObject({ value: '', dictation: { state: 'idle' } });
    });

    it('a refused microphone says so in the Composer', () => {
      const { panel, shown } = setup();
      panel.show(SESSION.id);
      panel.dictateStart('');
      fakeSpeech().fail('not-allowed');
      expect(composerOf(shown())?.dictation).toMatchObject({ state: 'idle', error: t('dictation.error.notAllowed') });
    });

    it('the Runner gone offline, or another Session opened, stops it and forgets its text', () => {
      const { panel, shown, store } = setup();
      panel.show(SESSION.id);
      panel.dictateStart('');
      fakeSpeech().say('Pense', false);
      store.set({ runner: OFFLINE });
      expect(fakeSpeech().listening).toBe(false);
      expect(composerOf(shown())).toMatchObject({ value: '', dictation: { state: 'idle' } });
      store.set({ runner: ONLINE });
      panel.dictateStart('');
      panel.show(null);
      expect(fakeSpeech().listening).toBe(false);
    });

    it('a disabled Composer dictates nothing', () => {
      const { panel } = setup({ runner: OFFLINE });
      panel.show(SESSION.id);
      panel.dictateStart('');
      expect(fakeSpeech().started).toBe(0);
    });

    it('without the API, the Composer has no mic', () => {
      removeSpeech();
      const { panel, shown } = setup();
      panel.show(SESSION.id);
      expect(composerOf(shown())?.dictation.available).toBe(false);
    });
  });
});
