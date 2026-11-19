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

const [changed, unchanged] = COMPOSANTS.PageParametresProjet.examples;
if (!changed?.slots || !unchanged?.slots) throw new Error('PageParametresProjet lacks its examples');

const links = (el: Element) => [...(el.shadowRoot?.querySelectorAll('nav a') ?? [])] as HTMLAnchorElement[];
const shown = (el: Element) =>
  [...el.children].filter((child) => (child as HTMLElement).offsetParent !== null).map((child) => child.getAttribute('slot'));

describe('cd-page-parametres-projet', () => {
  it('has the Projet’s name in its header, the count it changed, and a link back to the account’s Paramètres', async () => {
    const el = await render(COMPOSANTS.PageParametresProjet, { project: 'Site mairie', changedCount: 3, counts: { roles: 2, notifications: 1 } }, changed.slots);

    const header = inside(el, 'cd-page-header');
    expect(textOf(inside(header, 'h1'))).toBe('Site mairie');
    expect(textOf(header.shadowRoot)).toContain(t('settings.project.count.other', { count: 3 }));
    const back = inside<HTMLAnchorElement>(header, 'a');
    expect([textOf(back), back.getAttribute('href')]).toEqual([t('settings.project.back'), '/parametres']);

    const one = await render(COMPOSANTS.PageParametresProjet, { project: 'Site mairie', changedCount: 1, counts: {} }, changed.slots);
    expect(textOf(inside(one, 'cd-page-header').shadowRoot)).toContain(t('settings.project.count.one'));
    const none = await render(COMPOSANTS.PageParametresProjet, unchanged.data, unchanged.slots);
    expect(textOf(inside(none, 'cd-page-header').shadowRoot)).toContain(t('settings.project.count.none'));
  });

  it('says in an accent Banner that the Projet inherits from the account', async () => {
    const el = await render(COMPOSANTS.PageParametresProjet, changed.data, changed.slots);

    const banner = inside<HTMLElement & { data: { tone: string; title: string } }>(el, 'cd-banner');
    expect([banner.data.tone, banner.data.title]).toEqual(['accent', t('settings.project.banner.title')]);
    expect(textOf(banner)).toBe(t('settings.project.banner.body'));
  });

  it('builds its nav from the filled Emplacements, each with the count it changed', async () => {
    const el = await render(COMPOSANTS.PageParametresProjet, { project: 'Site mairie', changedCount: 3, counts: { roles: 2, notifications: 1 } }, changed.slots);

    expect(inside(el, 'nav').getAttribute('aria-label')).toBe(t('settings.project.nav'));
    expect(links(el).map((link) => [link.getAttribute('href'), textOf(link.querySelector('.n [aria-hidden]'))])).toEqual([
      ['#roles', '2'],
      ['#notifications', '1'],
    ]);
    expect(textOf(links(el)[0]?.querySelector('.visually-hidden'))).toBe(`, ${t('settings.project.sectionCount.other', { count: 2 })}`);

    const none = await render(COMPOSANTS.PageParametresProjet, unchanged.data, unchanged.slots);
    expect(links(none).map(textOf)).toEqual([t('settings.project.section.notifications')]);
    expect(none.shadowRoot?.querySelector('nav .n')).toBeNull();
  });

  it('shows every section at 1280 px, one at a time on the phone', async () => {
    const el = await render(COMPOSANTS.PageParametresProjet, changed.data, changed.slots);
    expect(shown(el)).toEqual(['roles', 'notifications']);

    await page.viewport(390, 844);
    await settle(el);
    expect(shown(el)).toEqual(['roles']);
    links(el)[1]?.click();
    await settle(el);
    expect(shown(el)).toEqual(['notifications']);
  });

  it('emits change with the name and the value of a section’s control, a Toggle’s checked state', async () => {
    const el = await render(COMPOSANTS.PageParametresProjet, changed.data, changed.slots);
    const native = inside<HTMLSelectElement>(el.querySelector('cd-select') as Element, 'select');

    const selected = await actionsOf(() => {
      native.value = 'claude-code:claude-sonnet-5-5';
      native.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(selected).toEqual([{ composant: 'PageParametresProjet', action: 'change', payload: { name: 'role:idea', value: 'claude-code:claude-sonnet-5-5' } }]);

    const toggled = await actionsOf(() => inside(el.querySelector('cd-toggle') as Element, 'button, input').click());
    expect(toggled).toEqual([{ composant: 'PageParametresProjet', action: 'change', payload: { name: 'push', value: false } }]);
  });
});
