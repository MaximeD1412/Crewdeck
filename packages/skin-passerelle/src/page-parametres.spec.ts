/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { page } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);

afterEach(async () => {
  document.body.replaceChildren();
  await page.viewport(1280, 800);
});

const [both, one] = COMPOSANTS.PageParametres.examples;
if (!both?.slots || !one?.slots) throw new Error('PageParametres lacks its examples');

const links = (el: Element) => [...(el.shadowRoot?.querySelectorAll('nav a') ?? [])] as HTMLAnchorElement[];
const shown = (el: Element) =>
  [...el.children].filter((child) => (child as HTMLElement).offsetParent !== null).map((child) => child.getAttribute('slot'));

describe('cd-page-parametres', () => {
  it('has the page’s header: « Paramètres », its subtitle', async () => {
    const el = await render(COMPOSANTS.PageParametres, {}, both.slots);

    const header = inside(el, 'cd-page-header');
    expect(textOf(inside(header, 'h1'))).toBe(t('settings.title'));
    expect(textOf(header.shadowRoot)).toContain(t('settings.subtitle'));
  });

  it('builds its nav from the filled Emplacements only, in their order', async () => {
    const el = await render(COMPOSANTS.PageParametres, {}, both.slots);

    expect(inside(el, 'nav').getAttribute('aria-label')).toBe(t('settings.nav'));
    expect(links(el).map(textOf)).toEqual([t('settings.section.account'), t('settings.section.modders')]);

    const only = await render(COMPOSANTS.PageParametres, {}, one.slots);
    expect(links(only).map(textOf)).toEqual([t('settings.section.modders')]);
  });

  it('follows an Emplacement filled later, or emptied', async () => {
    const el = await render(COMPOSANTS.PageParametres, {}, one.slots);
    const card = document.createElement('cd-card') as HTMLElement & { data: unknown };
    card.data = { title: 'Rôles et modèles' };
    card.slot = 'roles';
    el.append(card);
    await settle(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await settle(el);

    expect(links(el).map(textOf)).toEqual([t('settings.section.roles'), t('settings.section.modders')]);

    card.remove();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await settle(el);
    expect(links(el).map(textOf)).toEqual([t('settings.section.modders')]);
  });

  it('shows every section at 1280 px, the first link current', async () => {
    const el = await render(COMPOSANTS.PageParametres, {}, both.slots);

    expect(shown(el)).toEqual(['account', 'modders']);
    expect(links(el).map((link) => link.getAttribute('aria-current'))).toEqual(['true', null]);
  });

  it('shows one section at a time on the phone, the one its link opens', async () => {
    await page.viewport(390, 844);
    const el = await render(COMPOSANTS.PageParametres, {}, both.slots);

    expect(shown(el)).toEqual(['account']);
    links(el)[1]?.click();
    await settle(el);

    expect(shown(el)).toEqual(['modders']);
    expect(links(el).map((link) => link.getAttribute('aria-current'))).toEqual([null, 'true']);
  });

  it('emits change with the name and the value of a section’s control', async () => {
    const el = await render(COMPOSANTS.PageParametres, {}, both.slots);
    const native = inside<HTMLSelectElement>(el.querySelector('cd-select') as Element, 'select');

    const actions = await actionsOf(() => {
      native.value = 'Asia/Tokyo';
      native.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(actions).toEqual([{ composant: 'PageParametres', action: 'change', payload: { name: 'timeZone', value: 'Asia/Tokyo' } }]);
  });

  it('emits a Toggle’s change with its checked state', async () => {
    const toggle = `<cd-card data='{"title":"Notifications"}'><cd-toggle data='{"name":"push","label":"Notifications push","checked":false,"help":null,"state":null}'></cd-toggle></cd-card>`;
    const el = await render(COMPOSANTS.PageParametres, {}, { notifications: toggle });

    const actions = await actionsOf(() => inside(el.querySelector('cd-toggle') as Element, 'button, input').click());

    expect(actions).toEqual([{ composant: 'PageParametres', action: 'change', payload: { name: 'push', value: true } }]);
  });
});
