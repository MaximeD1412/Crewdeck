import type { AiAccount, Me, Runner, UsageAccount } from '@crewdeck/contracts';
import { createDispatcher } from './actions/dispatcher.js';
import { boot, type App } from './app.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' };
const AT = '2026-11-11T14:12:00.000Z';
const RUNNER: Runner = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a71',
  machine: 'atelier-pc',
  os: 'linux',
  arch: 'amd64',
  wsl: false,
  runnerVersion: '0.4.2',
  state: 'online',
  lastSeenAt: AT,
  linkedAt: AT,
};
const CLAUDE: AiAccount = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a72',
  engine: 'claude-code',
  installed: true,
  version: '2.1.3',
  knownVersion: true,
  kind: 'subscription',
  state: 'connected',
  models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true }],
  reportedAt: AT,
};

const WEEK: UsageAccount['windows'][number] = { id: 'week', usedPercent: 62, resetsAt: '2026-11-16T07:00:00.000Z', holdsUntilReset: false, measuredAt: AT };
const USAGE: UsageAccount = {
  id: CLAUDE.id,
  engine: 'claude-code',
  kind: 'subscription',
  windows: [WEEK],
  measuredAt: AT,
};

const CODEX_ID = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a73';

type WithData = HTMLElement & { data: Record<string, unknown> };

describe('« Runner et Comptes IA » in the page', () => {
  let app: App;
  let root: HTMLElement;
  const store = createStore();
  for (const slice of ['pilot', 'runner', 'runner-link'] as const) store.registerSlice(slice, { shape: 'single' });
  store.registerSlice('ai-account', { shape: 'collection' });
  store.registerSlice('usage', { shape: 'collection' });
  const page = () => root.querySelector<WithData>('cd-page-runner');

  beforeAll(async () => {
    // The page's clock, which the windows' resets are read against.
    vi.useFakeTimers({ now: new Date(AT), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    history.replaceState(null, '', '/runner');
    root = document.createElement('div');
    document.body.append(root);
    app = await boot({ root, dispatcher: createDispatcher(), me: async () => PILOT, store, connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() } });
  });

  afterAll(() => {
    app.stop();
    vi.useRealTimers();
  });

  it('opens at /runner, in the Cadre, with both Moteurs not connected before the snapshot', () => {
    expect(location.pathname).toBe('/runner');
    expect(page()?.closest('cd-cadre')).toBe(root.firstElementChild);
    expect(page()?.data).toMatchObject({ runner: null, command: 'crewdeck-runner login claude' });
    expect((page()?.data['engines'] as { engine: string; state: string }[]).map(({ engine, state }) => ({ engine, state }))).toEqual([
      { engine: 'claude-code', state: 'login-required' },
      { engine: 'codex', state: 'login-required' },
    ]);
  });

  it('follows the store: the Runner and the Comptes IA it reports, in real time', () => {
    store.applySnapshot({ seq: 1, pilot: PILOT, runner: RUNNER, 'runner-link': null, 'ai-account': [], devices: [], decisions: [], usage: [] });
    expect(page()?.data).toMatchObject({ runner: { machine: 'atelier-pc', state: 'online' } });

    store.applyEvent({ seq: 2, type: 'ai-account.upserted', payload: CLAUDE, at: AT });

    expect(page()?.data).toMatchObject({ command: 'crewdeck-runner login codex' });
    expect((page()?.data['engines'] as { models: unknown[] }[])[0]?.models).toEqual(CLAUDE.models);
  });

  it('places the usage of the Comptes IA in the page’s Emplacement `usage` once one arrives, and follows it', () => {
    const card = () => page()?.querySelector<WithData>(':scope > cd-usage-card[slot=usage]');
    expect(card()).toBeNull();

    store.applyEvent({ seq: 3, type: 'usage.upserted', payload: USAGE, at: AT });
    expect(card()?.data).toMatchObject({ title: 'Usage des Comptes IA', accounts: [{ title: 'Claude · abonnement', meters: [{ value: 62 }] }] });

    const placed = card();
    store.applyEvent({ seq: 4, type: 'usage.upserted', payload: { ...USAGE, windows: [{ ...WEEK, usedPercent: 70 }] }, at: AT });
    expect(card()).toBe(placed);
    expect(card()?.data).toMatchObject({ accounts: [{ meters: [{ value: 70 }] }] });
  });

  it('drops a window at its reset, and says a new month’s spend at the month’s end, without a new measure', () => {
    const card = () => page()?.querySelector<WithData>(':scope > cd-usage-card[slot=usage]');
    const fiveHour = { ...WEEK, id: 'five-hour' as const, resetsAt: '2026-11-11T15:40:00.000Z' };
    store.applyEvent({ seq: 5, type: 'usage.upserted', payload: { ...USAGE, windows: [fiveHour, WEEK] }, at: AT });
    store.applyEvent({
      seq: 6,
      type: 'usage.upserted',
      payload: { id: CODEX_ID, engine: 'codex', kind: 'api-key', windows: [], monthSpend: { costUsdMicros: 2_000_000, costEurCents: 184, endsAt: '2026-11-11T16:00:00.000Z' }, measuredAt: AT },
      at: AT,
    });
    expect(card()?.data).toMatchObject({ accounts: [{ meters: [{ label: 'Fenêtre de 5 h' }, { label: 'Semaine' }] }, { monthSpend: '1,84\u00a0€' }] });

    vi.advanceTimersByTime(new Date('2026-11-11T15:40:00.000Z').getTime() - Date.now());
    expect((card()?.data['accounts'] as { meters: { label: string }[] }[])[0]?.meters.map((meter) => meter.label)).toEqual(['Semaine']);

    vi.advanceTimersByTime(20 * 60_000);
    expect(card()?.data).toMatchObject({ accounts: [{}, { monthSpend: '0,00\u00a0€' }] });
  });

  it('gives the Cadre the Runner’s presence and the Moteurs connected, once live', () => {
    const cadre = () => root.querySelector<WithData>('cd-cadre')?.data;
    store.markLive();
    expect(cadre()).toMatchObject({ status: 'online', statusDetail: 'Claude Code', live: true });

    store.applyEvent({ seq: 7, type: 'runner.upserted', payload: { ...RUNNER, state: 'offline' }, at: AT });

    expect(cadre()).toMatchObject({ status: 'offline', live: false });
  });
});
