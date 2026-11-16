/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, type ComposantData, type PushSettings } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof PushSettings>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const [onIphone, toSubscribe, unavailable, denied] = COMPOSANTS.PushSettings.examples.map((example) => example.data as Data);
if (!onIphone || !toSubscribe || !unavailable || !denied) throw new Error('PushSettings lacks its examples');

const pushSettings = (data: Data) => render(COMPOSANTS.PushSettings, data);
const all = (el: Element, selector: string) => [...(el.shadowRoot?.querySelectorAll<WithData>(selector) ?? [])];
const has = (el: Element, selector: string) => el.shadowRoot?.querySelector(selector) != null;

describe('PushSettings', () => {
  it('shows the card « Notifications », the Toggle « Notifications push » with its help, a row per browser with « Retirer »', async () => {
    const el = await pushSettings(toSubscribe);
    expect(inside<WithData>(el, 'cd-card').data).toEqual({ title: 'Notifications', label: 'Paramètres / Notifications' });
    expect(inside<WithData>(el, 'cd-toggle').data).toEqual({
      name: 'push',
      label: 'Notifications push',
      checked: true,
      help: 'Sur tes appareils autorisés : quand une Décision t’attend et que tu n’as aucun onglet Crewdeck visible depuis 2 min, et quand le Runner est hors ligne alors que du travail attend.',
      state: null,
    });
    expect(all(el, 'cd-list-row').map((row) => row.data)).toEqual([
      { title: 'Safari · iPhone', meta: 'autorisé le 3 nov.', icon: 'bell' },
      { title: 'Chrome · Windows', meta: 'autorisé le 12 nov.', icon: 'bell' },
    ]);
    const remove = all(el, 'cd-list-row cd-button.remove');
    expect(remove.map((button) => [button.slot, button.data])).toEqual([
      ['trailing', { label: 'Retirer', variant: 'ghost', size: 'sm' }],
      ['trailing', { label: 'Retirer', variant: 'ghost', size: 'sm' }],
    ]);
  });

  it('switches the account’s push with `toggle`; the Toggle’s change stays inside', async () => {
    const el = await pushSettings(onIphone);
    const changes: Event[] = [];
    document.addEventListener('change', (event) => changes.push(event));
    expect(await actionsOf(() => inside(el, 'cd-toggle', 'button').click())).toEqual([
      { composant: 'PushSettings', action: 'toggle', payload: { push: false } },
    ]);
    expect(changes).toEqual([]);
  });

  it('removes a browser with `remove`', async () => {
    const el = await pushSettings(toSubscribe);
    const second = all(el, 'cd-list-row cd-button.remove')[1];
    expect(await actionsOf(() => inside(second as Element, 'button').click())).toEqual([
      { composant: 'PushSettings', action: 'remove', payload: { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02' } },
    ]);
  });

  it('offers « Activer sur cet appareil » with `subscribe`, loading and silent while busy', async () => {
    const el = await pushSettings(toSubscribe);
    expect(inside<WithData>(el, 'cd-button.subscribe').data).toEqual({ label: 'Activer sur cet appareil', variant: 'secondary', size: 'sm', icon: 'bell' });
    expect(await actionsOf(() => inside(el, 'cd-button.subscribe', 'button').click())).toEqual([
      { composant: 'PushSettings', action: 'subscribe', payload: {} },
    ]);
    (el as unknown as { data: Data }).data = { ...toSubscribe, busy: true };
    await settle(el);
    expect(inside<WithData>(el, 'cd-button.subscribe').data['state']).toBe('loading');
    expect(await actionsOf(() => inside(el, 'cd-button.subscribe', 'button').click())).toEqual([]);
  });

  it('says why the subscription failed under its button', async () => {
    const el = await pushSettings(denied);
    expect(textOf(inside(el, '.error'))).toBe('Les notifications sont bloquées pour Crewdeck dans ce navigateur.');
    expect(inside(el, '.error').getAttribute('role')).toBe('alert');
    expect(has(await pushSettings(toSubscribe), '.error')).toBe(false);
  });

  it('shows nothing to do on a browser already subscribed', async () => {
    const el = await pushSettings(onIphone);
    expect(has(el, 'cd-button.subscribe')).toBe(false);
    expect(has(el, '.install')).toBe(false);
  });

  it('shows the help of the home screen where this browser cannot receive any', async () => {
    const el = await pushSettings(unavailable);
    expect(has(el, 'cd-button.subscribe')).toBe(false);
    expect(textOf(inside(el, '.install'))).toBe(
      'Sur iPhone, ajoute Crewdeck à l’écran d’accueil (Partager → Sur l’écran d’accueil) pour recevoir les notifications.',
    );
    expect(all(el, 'cd-list-row')).toEqual([]);
  });
});
