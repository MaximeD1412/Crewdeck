import { Banner, t } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { ApiError } from './api/request.js';
import { boot, type App } from './app.js';
import { createStore } from './store/store.js';

const PILOT = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris' };
const AT = '2026-11-11T08:00:00.000Z';
const STALE = 'L’état a changé depuis ton dernier affichage : vérifie avant de recommencer.';

type WithData = HTMLElement & { data: unknown };

// One page, booted once (a page has one Skin): the tests follow one another on it.
const store = createStore();
store.registerSlice('pilot', { shape: 'single' });
let app: App;
let cadre: WithData;

const banners = () => [...cadre.querySelectorAll<WithData>(`:scope > ${Banner.tag}[slot=banner]`)].map((banner) => banner.data);

const unhandled = (reason: unknown) => {
  const event = Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason });
  window.dispatchEvent(event);
  return event;
};

beforeAll(async () => {
  history.replaceState(null, '', '/a-toi');
  const root = document.createElement('div');
  document.body.append(root);
  app = await boot({ root, dispatcher: createDispatcher(), me: async () => PILOT, store, connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() } });
  cadre = root.firstElementChild as WithData;
});

afterAll(() => app.stop());

describe('the page’s Cadre follows its store', () => {
  it('shows the Pilote of /api/me until the snapshot, then the pilot slice’s', () => {
    expect(cadre.data).toMatchObject({ status: 'resync', pilot: { login: 'octocat' } });
    store.applySnapshot({ seq: 3, pilot: { ...PILOT, login: 'from-snapshot' }, runner: null });
    store.markLive();
    expect(cadre.data).toMatchObject({ status: 'offline', statusDetail: null, pilot: { login: 'from-snapshot' } });
    expect(banners()).toEqual([]);
  });

  it('a lost socket: the Cadre’s « Resynchronisation… » and its Banner; live again with the replay: both gone', () => {
    store.markLost(new Date(AT));
    expect(cadre.data).toMatchObject({ status: 'resync', statusDetail: t('cadre.status.resyncDetail') });
    expect(banners()).toEqual([{ tone: 'caution', title: 'Resynchronisation…', icon: 'refresh' }]);

    store.applyEvent({ seq: 4, type: 'pilot.upserted', payload: { ...PILOT, login: 'replayed' }, at: AT });
    store.markLive();
    expect(cadre.data).toMatchObject({ status: 'offline', pilot: { login: 'replayed' } });
    expect(banners()).toEqual([]);
  });

  it('an ApiError no caller handled: a halt Banner, its message as is, until the next navigation', () => {
    const event = unhandled(new ApiError({ status: 409, code: 'realtime.stale', message: STALE }));
    expect(event.defaultPrevented).toBe(true);
    expect(banners()).toEqual([{ tone: 'halt', title: STALE, icon: 'alert' }]);

    expect(unhandled(new Error('not the API')).defaultPrevented).toBe(false);

    app.router.navigate('/idees');
    expect(banners()).toEqual([]);
  });
});
