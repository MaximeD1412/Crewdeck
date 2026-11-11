import { DEFAULT_ACCOUNT_SETTINGS } from '@crewdeck/contracts';
import { emitAction, PageParametres } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';
import { createStore } from './store/store.js';

const PILOT = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' } as const;

// Its own file: a page has one Skin, booted once.
describe('the page’s Paramètres', () => {
  it('open at /parametres: « Pour les Moddeurs », then « Compte » once the store has the settings, following their events; a time zone picked is sent to PATCH /api/settings', async () => {
    history.replaceState(null, '', '/parametres');
    const root = document.createElement('div');
    document.body.append(root);
    const store = createStore();
    store.registerSlice('pilot', { shape: 'single' });
    store.registerSlice('settings', { shape: 'single' });
    const command = vi.fn(async () => undefined);
    const app = await boot({
      root,
      dispatcher: createDispatcher(),
      me: async () => PILOT,
      store,
      connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() },
      client: { command, query: vi.fn() },
    });

    const page = root.querySelector('cd-page-parametres') as HTMLElement;
    expect(page.closest('cd-cadre')).toBe(root.firstElementChild);
    const slotsOf = () => [...page.children].map((child) => child.getAttribute('slot'));
    expect(slotsOf()).toEqual(['modders']);

    const settings = { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' };
    store.applySnapshot({ seq: 1, pilot: PILOT, runner: null, 'runner-link': null, settings });
    expect(slotsOf()).toEqual(['account', 'modders']);
    const select = page.querySelector('cd-select') as HTMLElement & { data: { value: string } };
    expect(select.data.value).toBe('Europe/Paris');

    store.applyEvent({ seq: 2, type: 'settings.upserted', payload: { ...settings, timeZone: 'Asia/Tokyo' }, at: '2026-11-11T08:00:00.000Z' });
    expect(page.querySelector('cd-select')).toBe(select);
    expect(select.data.value).toBe('Asia/Tokyo');

    emitAction(page, PageParametres, 'change', { name: 'timeZone', value: 'America/Montreal' });
    expect(command).toHaveBeenCalledWith('PATCH', '/api/settings', { timeZone: 'America/Montreal' }, expect.anything());
    emitAction(page, PageParametres, 'change', { name: 'unknown', value: true });
    expect(command).toHaveBeenCalledTimes(1);
    app.stop();
  });
});
