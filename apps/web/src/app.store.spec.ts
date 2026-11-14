import type { Me } from '@crewdeck/contracts';
import { Banner, t } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { ApiError } from './api/request.js';
import { boot, type App } from './app.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [] };
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
    expect(cadre.data).toMatchObject({ status: 'resync', pilot: { displayName: 'octocat' } });
    store.applySnapshot({ seq: 3, pilot: { ...PILOT, displayName: 'from-snapshot' }, runner: null, 'runner-link': null, 'ai-account': [], devices: [], decisions: [] });
    store.markLive();
    expect(cadre.data).toMatchObject({ status: 'offline', statusDetail: null, pilot: { displayName: 'from-snapshot' } });
    expect(banners()).toEqual([]);
  });

  it('a lost socket: the Cadre’s « Resynchronisation… » and its Banner; live again with the replay: both gone', () => {
    store.markLost(new Date(AT));
    expect(cadre.data).toMatchObject({ status: 'resync', statusDetail: t('cadre.status.resyncDetail') });
    expect(banners()).toEqual([{ tone: 'caution', title: 'Resynchronisation…', icon: 'refresh' }]);

    store.applyEvent({ seq: 4, type: 'pilot.upserted', payload: { ...PILOT, displayName: 'replayed' }, at: AT });
    store.markLive();
    expect(cadre.data).toMatchObject({ status: 'offline', pilot: { displayName: 'replayed' } });
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

  it('a change of the store a page does not read leaves it as is: a preview keeps what was typed in it', async () => {
    type Lit = HTMLElement & { updateComplete: Promise<unknown> };
    app.router.navigate('/parametres/composants?c=TextField');
    const page = cadre.querySelector<Lit>('cd-page-composants');
    await page?.updateComplete;
    const preview = page?.shadowRoot?.querySelector<Lit>('.stage cd-text-field');
    await preview?.updateComplete;
    const input = preview?.shadowRoot?.querySelector('input');
    if (!preview || !input) throw new Error('no preview of TextField');
    input.value = 'tapé';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

    store.applyEvent({ seq: 5, type: 'pilot.upserted', payload: { ...PILOT, displayName: 'renamed' }, at: AT });
    await page?.updateComplete;
    expect(cadre.data).toMatchObject({ pilot: { displayName: 'renamed' } });
    expect(page?.shadowRoot?.querySelector('.stage cd-text-field')).toBe(preview);
    expect(preview.shadowRoot?.querySelector('input')?.value).toBe('tapé');
  });
});
