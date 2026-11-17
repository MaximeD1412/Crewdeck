import { DEFAULT_ACCOUNT_SETTINGS, type AgentSession, type Me } from '@crewdeck/contracts';
import { Cadre, Session } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import type { Client } from './api/client.js';
import { boot, type App } from './app.js';
import type { SessionRelay } from './sessions/relay.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [] };
const SESSION: AgentSession = {
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a7b',
  projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02',
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

type WithData = HTMLElement & { data: unknown };

// One page, booted once: the tests follow one another on it.
const store = createStore();
store.registerSlice('pilot', { shape: 'single' });
store.registerSlice('runner', { shape: 'single' });
store.registerSlice('agent-session', { shape: 'collection', snapshotKey: 'sessions' });
const command = vi.fn(async () => SESSION) as unknown as Client['command'];
const relay = {
  openSession: vi.fn<SessionRelay['openSession']>((sessionId) => ({ sessionId, events: () => [], error: () => null, onChange: () => () => undefined })),
  closeSession: vi.fn<SessionRelay['closeSession']>(),
  sendInput: vi.fn<SessionRelay['sendInput']>(async () => 'input-1'),
};
let app: App;
let root: HTMLElement;

const panel = () => root.querySelector<WithData>(`${Cadre.tag} > [slot=panel]`);
const act = (composant: string, action: string, payload: unknown) => app.dispatcher.dispatch({ composant, action, payload });

beforeAll(async () => {
  history.replaceState(null, '', '/a-toi');
  root = document.createElement('div');
  document.body.append(root);
  app = await boot({
    root,
    dispatcher: createDispatcher(),
    me: async () => PILOT,
    store,
    client: { command, query: vi.fn() },
    relay,
    connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() },
  });
  store.applySnapshot({ seq: 3, pilot: PILOT, runner: { state: 'online', lastSeenAt: '2026-11-11T14:04:58.000Z' } as never, 'runner-link': null, 'ai-account': [], 'mcp-server': [], devices: [], projects: [], processes: [], phaseRuns: [], stepRuns: [], repositories: [], decisions: [], ideas: [], tickets: [], milestones: [], codeChanges: [], sessions: [SESSION], settings: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' } });
  store.markLive();
});

afterAll(() => app.stop());

describe('the Session panel over the page', () => {
  it('opens with `?session=` in the Cadre’s panel Emplacement, the page still under it', () => {
    app.router.navigate(`/a-toi?session=${SESSION.id}`);
    expect(panel()?.localName).toBe(Session.tag);
    expect(panel()?.data).toMatchObject({ title: SESSION.title });
    expect(root.querySelector('cd-page-a-toi')).not.toBeNull();
    expect(relay.openSession).toHaveBeenCalledWith(SESSION.id);
  });

  it('« Arrêter », « Reprendre » and the Composer act on the open Session', async () => {
    act('Session', 'stop', {});
    act('Session', 'resume', {});
    act('Composer', 'send', { text: 'Pense aux événements récurrents.' });
    await vi.waitFor(() => expect(relay.sendInput).toHaveBeenCalledWith(SESSION.id, { kind: 'message', text: 'Pense aux événements récurrents.' }));
    expect(command).toHaveBeenCalledWith('POST', `/api/sessions/${SESSION.id}/stop`, expect.anything(), expect.anything());
    expect(command).toHaveBeenCalledWith('POST', `/api/sessions/${SESSION.id}/resume`, expect.anything(), expect.anything());
  });

  it('« Fermer » takes `?session=` away: the page stays, the panel and the relay closed', () => {
    act('Session', 'close', {});
    expect(location.pathname + location.search).toBe('/a-toi');
    expect(panel()).toBeNull();
    expect(relay.closeSession).toHaveBeenCalledWith(SESSION.id);
  });
});
