import type { AgentSession } from '@crewdeck/contracts';
import { Button, Empty, Session, t } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { getSession, resumeSession, stopSession } from './api/sessions.js';
import { placeNode, type PlacedNode } from './placed.js';
import type { Shell } from './shell.js';
import { SessionInputError, type SessionRelay, type SessionSubscription } from './sessions/relay.js';
import type { Store } from './store/store.js';
import { sessionNotFoundView, sessionView, type PilotMessage } from './views/session.js';

export interface SessionPanelOptions {
  readonly store: Pick<Store, 'getState' | 'subscribe'>;
  readonly client: Pick<Client, 'query' | 'command'>;
  readonly relay: Pick<SessionRelay, 'openSession' | 'sendInput' | 'closeSession'>;
  readonly shell: Pick<Shell, 'setPanel' | 'showError'>;
  /** Moves to a page of the app: « Voir le Runner ». */
  readonly navigate: (url: string) => void;
  /** Closes the panel: the page without its `?session=`. */
  readonly close: () => void;
  readonly now?: () => Date;
  /** How long a write to a stopped Session waits for it to run again, in ms. */
  readonly readyTimeout?: number;
}

export interface SessionPanel {
  /** The panel the route asks (`?session=<id>`), or none (`null`). */
  show(sessionId: string | null): void;
  /** « Arrêter » and « Reprendre »: a refusal is an `ApiError`, the page shows it. */
  stop(): Promise<void>;
  resume(): Promise<void>;
  /** The Composer's text to the agent; a stopped or interrupted Session resumed first. Why it was not sent, in the Cadre. */
  send(text: string): Promise<void>;
  dispose(): void;
}

const RUNNING: ReadonlySet<AgentSession['state']> = new Set(['active', 'waiting']);
const RESUMABLE: ReadonlySet<AgentSession['state']> = new Set(['stopped', 'interrupted']);
const SEND_FAILED: Readonly<Record<SessionInputError['code'], 'session.send.failed' | 'session.send.tooLarge'>> = {
  'no-key': 'session.send.failed',
  'not-connected': 'session.send.failed',
  'too-large': 'session.send.tooLarge',
};

/**
 * The Session panel (SESSION-2, US-9, US-60) over any page: the Session of
 * `?session=` from the store, else read by its id (one ended beyond the
 * store's 24 h, another's: « Session introuvable »), its conversation from
 * the relay while the Runner is online, the relay closed while it is not
 * (only the title and state then), « <Moteur> travaille » counted each second
 * while it runs. The Pilote's messages stay in this tab, after the event they
 * followed: the Runner keeps no log of them.
 */
export const createSessionPanel = ({
  store,
  client,
  relay,
  shell,
  navigate,
  close,
  now = () => new Date(),
  readyTimeout = 15_000,
}: SessionPanelOptions): SessionPanel => {
  let id: string | null = null;
  /** The Session read by its id when the store does not hold it; `not-found` for another's, or none. */
  let fetched: AgentSession | 'not-found' | 'reading' | null = null;
  let subscription: { readonly value: SessionSubscription; readonly stop: () => void } | null = null;
  let sent: PilotMessage[] = [];
  let element: (HTMLElement & { data?: unknown }) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const waiters = new Set<() => void>();

  const sessionOf = (sessionId: string): AgentSession | null => {
    const held = store.getState().slices['agent-session']?.get(sessionId);
    return held ?? (typeof fetched === 'object' ? fetched : null);
  };

  const read = (sessionId: string) => {
    fetched = 'reading';
    getSession(client, sessionId).then(
      (session) => {
        if (id === sessionId) fetched = session;
      },
      (error: unknown) => {
        if (id !== sessionId) return;
        fetched = 'not-found';
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      },
    ).finally(() => {
      if (id === sessionId) render();
    });
  };

  const unfollow = () => {
    if (!subscription || id === null) return;
    subscription.stop();
    subscription = null;
    relay.closeSession(id);
  };

  const follow = (sessionId: string) => {
    if (subscription) return;
    const value = relay.openSession(sessionId);
    subscription = { value, stop: value.onChange(render) };
  };

  const tick = (running: boolean) => {
    if (running && timer === null) timer = setInterval(render, 1000);
    if (!running && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const mount = (node: PlacedNode, onAction: () => void) => {
    if (element?.localName !== node.tag) {
      element = document.createElement(node.tag);
      shell.setPanel(element);
    }
    placeNode(element, node);
    const button = (element.localName === Empty.tag ? element : element.querySelector(Empty.tag))?.querySelector<HTMLElement>(`:scope > ${Button.tag}`);
    if (button) button.onclick = onAction;
  };

  function render(): void {
    for (const waiter of waiters) waiter();
    if (id === null) return;
    const session = sessionOf(id);
    if (!session) {
      if (fetched === null) read(id);
      tick(false);
      if (fetched === 'not-found') mount(sessionNotFoundView(), close);
      return;
    }
    const { slices } = store.getState();
    if (slices.runner?.state === 'online') follow(id);
    else unfollow();
    if (subscription?.value.error() === 'session.not-found') {
      tick(false);
      mount(sessionNotFoundView(), close);
      return;
    }
    const view = sessionView({ session, slices, events: subscription?.value.events() ?? [], sent, now: now() });
    tick(view.data.status !== null);
    mount({ tag: Session.tag, data: view.data, children: view.children }, () => navigate('/runner'));
  }

  const reset = () => {
    unfollow();
    tick(false);
    fetched = null;
    sent = [];
    element = null;
    shell.setPanel(null);
  };

  /** Resolves true once the Session runs (`active` or `waiting`), false after `readyTimeout`. */
  const running = (sessionId: string): Promise<boolean> =>
    new Promise((resolve) => {
      const check = () => {
        const state = id === sessionId ? sessionOf(sessionId)?.state : undefined;
        if (state === undefined || RUNNING.has(state)) done(state !== undefined);
      };
      const timeout = setTimeout(() => done(false), readyTimeout);
      const done = (ok: boolean) => {
        clearTimeout(timeout);
        waiters.delete(check);
        resolve(ok);
      };
      waiters.add(check);
      check();
    });

  const unsubscribe = store.subscribe(() => render());

  return {
    show(sessionId) {
      if (sessionId === id) return render();
      reset();
      id = sessionId;
      render();
    },
    async stop() {
      if (id !== null) await stopSession(client, id);
    },
    async resume() {
      if (id !== null) await resumeSession(client, id);
    },
    async send(text) {
      const sessionId = id;
      const session = sessionId === null ? null : sessionOf(sessionId);
      if (sessionId === null || !session) return;
      if (RESUMABLE.has(session.state)) await resumeSession(client, sessionId);
      if (!(await running(sessionId))) return shell.showError(t('session.send.notResumed'));
      const afterSeq = subscription?.value.events().at(-1)?.seq ?? 0;
      try {
        await relay.sendInput(sessionId, { kind: 'message', text });
      } catch (error) {
        if (!(error instanceof SessionInputError)) throw error;
        return shell.showError(t(SEND_FAILED[error.code]));
      }
      if (id !== sessionId) return;
      sent = [...sent, { text, at: now().toISOString(), afterSeq }];
      render();
    },
    dispose() {
      unsubscribe();
      reset();
      id = null;
    },
  };
};
