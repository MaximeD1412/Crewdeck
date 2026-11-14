import { DEFAULT_ACCOUNT_SETTINGS, type Decision, type Me } from '@crewdeck/contracts';
import { MenuItem } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot, type App } from './app.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' };
const CREWDECK = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01';
const AT = '2026-11-11T08:00:00.000Z';

const decision = (n: number, fields: Partial<Decision> = {}): Decision => ({
  id: `0193a4f2-7c1e-7a10-8b2c-00000000000${n}`,
  kind: 'ticket-blocked',
  projectId: CREWDECK,
  projectName: 'Crewdeck',
  subjectType: 'ticket',
  subjectId: String(n),
  label: `#${n} Ticket`,
  metaParts: [],
  tone: 'halt',
  link: `/boucle?ticket=${n}`,
  params: {},
  state: 'open',
  outcome: null,
  createdAt: new Date(Date.parse(AT) + n * 60_000).toISOString(),
  resolvedAt: null,
  ...fields,
});

type WithData = HTMLElement & { data: unknown };
interface PageData {
  readonly total: number;
  readonly decisions: readonly { readonly id: string; readonly title: string }[];
}

// One page, booted once: the tests follow one another on it.
const store = createStore();
store.registerSlice('pilot', { shape: 'single' });
store.registerSlice('runner', { shape: 'single' });
store.registerSlice('decision', { shape: 'collection', snapshotKey: 'decisions' });
let app: App;
let root: HTMLElement;

const page = () => root.querySelector<WithData>('cd-page-a-toi');
const pageData = () => page()?.data as PageData;
const aToiCount = () =>
  [...root.querySelectorAll<WithData>(MenuItem.tag)].map((item) => item.data as { id: string; count: number | null }).find((item) => item.id === 'a-toi')
    ?.count;
const act = (action: string, payload: unknown) => app.dispatcher.dispatch({ composant: 'PageAToi', action, payload });

beforeAll(async () => {
  history.replaceState(null, '', '/a-toi');
  root = document.createElement('div');
  document.body.append(root);
  app = await boot({ root, dispatcher: createDispatcher(), me: async () => PILOT, store, connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() } });
});

afterAll(() => app.stop());

describe('« À toi » follows the store', () => {
  it('lists the snapshot’s open Décisions, the Cadre counting them', () => {
    expect(pageData()).toMatchObject({ total: 0, decisions: [] });
    store.applySnapshot({ seq: 3, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [], devices: [], decisions: [decision(1)], settings: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' } });
    store.markLive();
    expect(pageData().decisions.map((row) => row.title)).toEqual(['#1 Ticket']);
    expect(aToiCount()).toBe(1);
  });

  it('shows a Décision raised and drops one resolved, without a reload', () => {
    const shown = page();
    store.applyEvent({ seq: 4, type: 'decision.upserted', payload: decision(2), at: AT });
    expect(page()).toBe(shown);
    expect(pageData().decisions.map((row) => row.title)).toEqual(['#2 Ticket', '#1 Ticket']);
    expect(aToiCount()).toBe(2);
    store.applyEvent({ seq: 5, type: 'decision.removed', payload: { id: decision(1).id }, at: AT });
    expect(pageData().decisions.map((row) => row.title)).toEqual(['#2 Ticket']);
    expect(aToiCount()).toBe(1);
  });

  it('a chip filters by Projet through the URL, « Tous les Projets » takes the filter away', () => {
    act('filter', { projectId: CREWDECK });
    expect(location.pathname + location.search).toBe(`/a-toi?projet=${CREWDECK}`);
    act('filter', { projectId: null });
    expect(location.pathname + location.search).toBe('/a-toi');
  });

  it('a row and its « Ouvrir » lead to the Décision’s link; « Noter une Idée » to Idées', () => {
    act('open', { id: decision(2).id });
    expect(location.pathname + location.search).toBe('/boucle?ticket=2');
    app.router.navigate('/a-toi');
    act('act', { id: decision(2).id, action: 'open' });
    expect(location.pathname + location.search).toBe('/boucle?ticket=2');
    app.router.navigate('/a-toi');
    act('act', { id: decision(1).id, action: 'open' });
    expect(location.pathname).toBe('/a-toi');
    act('note-idea', {});
    expect(location.pathname).toBe('/idees');
  });
});
