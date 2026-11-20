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

const [four, chosen, emptyTab, none, older, failed] = COMPOSANTS.PageIdees.examples;
if (!four || !chosen || !emptyTab || !none || !older || !failed) throw new Error('PageIdees lacks its examples');

const rows = (el: Element) => [...(el.shadowRoot?.querySelectorAll('cd-idea-row') ?? [])];
const chips = (el: Element) => [...(inside(el, 'cd-project-filter').shadowRoot?.querySelectorAll('cd-chip') ?? [])];
const tabs = (el: Element) => [...(inside(el, 'cd-tabs').shadowRoot?.querySelectorAll('button') ?? [])];

describe('PageIdees', () => {
  it('titles the page « Idées » with the Idées to triage counted, and holds « Noter une Idée »', async () => {
    const el = await render(COMPOSANTS.PageIdees, four.data);
    expect(textOf(inside(el, 'cd-page-header', 'h1'))).toBe('Idées');
    expect(textOf(inside(el, 'cd-page-header', '.count'))).toBe('4 à trier');
    expect(textOf(inside(el, 'cd-button.note', 'button'))).toBe('Noter une Idée');
    expect(inside(el, 'cd-button.note').slot).toBe('actions');
  });

  it('shows a chip per Projet with its count, the selected one pressed', async () => {
    const el = await render(COMPOSANTS.PageIdees, chosen.data);
    expect(chips(el).map((chip) => textOf(inside(chip, 'button')))).toEqual([
      'Tous les Projets4',
      'Crewdeck1',
      'Personal OS2',
      'Site mairie1',
      'Tennis Manager',
    ]);
    expect(chips(el).map((chip) => inside(chip, 'button').getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false']);
  });

  it('shows the four tabs with their counts, « À trier » selected', async () => {
    const el = await render(COMPOSANTS.PageIdees, four.data);
    expect(tabs(el).map((tab) => textOf(tab))).toEqual(['À trier4', 'Retenues3', 'Fusionnées1', 'Rejetées2']);
    expect(tabs(el).map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('lists the tab’s Idées, in order, in a Card titled by the tab', async () => {
    const el = await render(COMPOSANTS.PageIdees, four.data);
    const card = inside(el, 'cd-card.list');
    expect(textOf(inside(card, 'h2'))).toBe('À trier4');
    expect(inside(card, 'section').getAttribute('aria-label')).toBe('Idées / Liste');
    expect(rows(el).map((row) => textOf(inside(row, '.title')))).toEqual(four.data.ideas.map((idea) => idea.title));
    expect(rows(el).map((row) => textOf(inside(row, '.meta')))).toEqual([
      '#64 · Crewdeck · il y a 5 min',
      '#63 · Personal OS · il y a 2 h',
      '#62 · Site mairie · hier',
      '#61 · Personal OS · il y a 3 j',
    ]);
  });

  it('says so when the tab has no Idée', async () => {
    const el = await render(COMPOSANTS.PageIdees, emptyTab.data);
    expect(rows(el)).toEqual([]);
    expect(inside(el, 'cd-empty').closest('cd-card')?.classList.contains('list')).toBe(true);
    expect(textOf(inside(el, 'cd-empty', '.title'))).toBe(t('idees.tabEmpty.title'));
  });

  it('with no Idée at all, shows « Aucune Idée pour l’instant » and its button, without chips nor tabs', async () => {
    const el = await render(COMPOSANTS.PageIdees, none.data);
    expect(textOf(inside(el, 'cd-page-header', '.count'))).toBe('0');
    expect(el.shadowRoot?.querySelector('cd-button.note')).toBeNull();
    expect(el.shadowRoot?.querySelector('cd-project-filter')).toBeNull();
    expect(el.shadowRoot?.querySelector('cd-tabs')).toBeNull();
    expect(textOf(inside(el, 'cd-empty', '.title'))).toBe('Aucune Idée pour l’instant');
    expect(textOf(inside(el, 'cd-button.note-empty', 'button'))).toBe('Noter une Idée');
    expect(await actionsOf(() => inside(el, 'cd-button.note-empty', 'button').click())).toEqual([
      { composant: 'PageIdees', action: 'note', payload: {} },
    ]);
  });

  it('emits its own actions, never its rows’, its chips’ nor its tabs’', async () => {
    const el = await render(COMPOSANTS.PageIdees, four.data);
    const first = four.data.ideas[0];
    if (!first) throw new Error('no Idée');
    expect(await actionsOf(() => inside(el, 'cd-button.note', 'button').click())).toEqual([{ composant: 'PageIdees', action: 'note', payload: {} }]);
    expect(await actionsOf(() => inside(rows(el)[0] as Element, '.open').click())).toEqual([
      { composant: 'PageIdees', action: 'open', payload: { id: first.id } },
    ]);
    expect(await actionsOf(() => inside(chips(el)[2] as Element, 'button').click())).toEqual([
      { composant: 'PageIdees', action: 'filter', payload: { projectId: four.data.projects[2]?.projectId } },
    ]);
    expect(await actionsOf(() => inside(chips(el)[0] as Element, 'button').click())).toEqual([
      { composant: 'PageIdees', action: 'filter', payload: { projectId: null } },
    ]);
    expect(await actionsOf(() => tabs(el)[2]?.click())).toEqual([{ composant: 'PageIdees', action: 'tab', payload: { tab: 'fusionnees' } }]);
  });

  it('under the list, while older Idées remain, holds « Afficher les plus anciennes », which emits more, and waits while they come', async () => {
    const el = await render(COMPOSANTS.PageIdees, older.data);
    expect(rows(el).map((row) => textOf(inside(row, '.title')))).toEqual(['Envoyer le planning par e-mail']);
    const more = inside(el, 'cd-button.more');
    expect(more.getBoundingClientRect().top).toBeGreaterThan(inside(el, 'cd-card.list').getBoundingClientRect().bottom - 1);
    expect(textOf(inside(more, 'button'))).toBe('Afficher les plus anciennes');
    expect(await actionsOf(() => inside(el, 'cd-button.more', 'button').click())).toEqual([{ composant: 'PageIdees', action: 'more', payload: {} }]);

    el.data = { ...older.data, older: 'loading' };
    await settle(el);
    expect(inside<HTMLButtonElement>(el, 'cd-button.more', 'button').disabled).toBe(true);

    el.data = { ...older.data, older: 'none' };
    await settle(el);
    expect(el.shadowRoot?.querySelector('cd-button.more')).toBeNull();
    expect((await render(COMPOSANTS.PageIdees, four.data)).shadowRoot?.querySelector('cd-button.more')).toBeNull();
  });

  it('sets its aside beside the list from 1280 px, hides it narrower, and drops an empty one', async () => {
    const el = await render(COMPOSANTS.PageIdees, four.data, { aside: '<p>Analyse</p>' });
    const aside = inside(el, '.aside');
    expect(aside.hidden).toBe(false);
    expect(aside.getBoundingClientRect().left).toBeGreaterThan(inside(el, 'cd-card.list').getBoundingClientRect().right);
    await page.viewport(390, 800);
    await settle(el);
    expect(aside.checkVisibility()).toBe(false);
    expect(inside(el, 'cd-card.list').checkVisibility()).toBe(true);

    const bare = await render(COMPOSANTS.PageIdees, four.data);
    expect(inside(bare, '.aside').hidden).toBe(true);
  });

  it('lets the Emplacement list replace the list', async () => {
    const el = await render(COMPOSANTS.PageIdees, four.data, { list: '<p class="mine">Ma liste</p>' });
    const slot = inside<HTMLSlotElement>(el, 'slot[name="list"]');
    expect(slot.assignedElements().map((node) => node.className)).toEqual(['mine']);
  });
  it('marks the row whose analysis failed « Analyse échouée », with « Relancer l’analyse », which emits reanalyse and opens nothing', async () => {
    const el = await render(COMPOSANTS.PageIdees, failed.data);
    const [first, second] = rows(el);
    if (!first || !second) throw new Error('no rows');
    const badge = first.querySelector('cd-status-badge') as (HTMLElement & { data: { tone: string; label: string } }) | null;
    expect(badge?.slot).toBe('actions');
    expect(badge?.data).toEqual({ tone: 'halt', label: 'Analyse échouée' });
    expect(textOf(inside(el, 'cd-idea-row cd-button.reanalyse', 'button'))).toBe('Relancer l’analyse');
    expect(textOf(inside(first, '.context'))).toBe('L’analyse a échoué : son Contrat n’est pas rempli.');
    expect(inside(first, '.open').getAttribute('aria-current')).toBe('true');
    expect(second.querySelector('cd-button.reanalyse')).toBeNull();
    expect(await actionsOf(() => inside(el, 'cd-idea-row cd-button.reanalyse', 'button').click())).toEqual([
      { composant: 'PageIdees', action: 'reanalyse', payload: { id: failed.data.ideas[0]?.id } },
    ]);
  });
});
