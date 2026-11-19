/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, type ComposantData } from '@crewdeck/sdk';
import { page } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);

beforeEach(async () => {
  await page.viewport(1280, 800);
});

afterEach(async () => {
  document.body.replaceChildren();
  await page.viewport(1280, 800);
});

const { PageProcessEditor } = COMPOSANTS;
type Data = ComposantData<typeof PageProcessEditor>;
const [active, withGap, review, phase, sources, migrating, noVersion, notFound] = PageProcessEditor.examples.map((example) => example.data as Data);
if (!active || !withGap || !review || !phase || !sources || !migrating || !noVersion || !notFound) throw new Error('PageProcessEditor lacks its examples');

const show = async (data: Data) => render(PageProcessEditor, data);
const root = (el: Element) => el.shadowRoot!;
const tabs = (el: Element) => [...(inside(el, 'cd-tabs').shadowRoot?.querySelectorAll('button[role=tab]') ?? [])];
const panel = (el: Element) => inside(el, '.panel-body');
const parts = (item: Element) => ['b', '.mono', 'small'].map((part) => textOf(item.querySelector(part)) ?? null);
const only = (details: { action: string; payload: unknown }[]) => details.map(({ action, payload }) => ({ action, payload }));
const icon = (item: Element) => (item.querySelector('cd-icon') as HTMLElement & { data: { name: string } }).data.name;
type SelectEl = HTMLElement & { value: string; data: { label: string; value: string; state: string | null; options: { label: string }[] } };

describe('PageProcessEditor', () => {
  it('titles the page « Gestion du process », its back link to the Projet, its count the version shown', async () => {
    const el = await show(active);
    expect(textOf(inside(el, 'cd-page-header', 'h1'))).toBe('Gestion du process');
    const back = inside<HTMLAnchorElement>(el, 'cd-page-header', 'a.back');
    expect(textOf(back)).toBe('Site mairie');
    expect(back.getAttribute('href')).toBe('/projets');
    expect(textOf(inside(el, 'cd-page-header', '.count'))).toBe('v3 active');
    expect(root(el).querySelector('cd-banner')).toBeNull();
  });

  it('fills the height with the canvas, read only, and its panel on « Manques », « Aucun Manque » when there is none', async () => {
    const el = await show(active);
    const canvas = inside(el, '.editor cd-process-canvas') as HTMLElement & { data: unknown };
    expect(canvas.data).toEqual(active.canvas);
    expect(inside(el, '.editor').getAttribute('aria-label')).toBe('Gestion du process / Éditeur');
    expect(inside(el, 'aside').getAttribute('aria-label')).toBe('Gestion du process / Panneau');
    expect(tabs(el).map((tab) => textOf(tab))).toEqual(['Manques0', 'Étape', 'Sources']);
    expect(tabs(el).map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    const empty = inside(panel(el), 'cd-empty') as HTMLElement & { data: unknown };
    expect(empty.data).toEqual({ icon: 'check', title: 'Aucun Manque' });
    expect(textOf(empty)).toContain('le Process est activable');
    const canvasBox = canvas.getBoundingClientRect();
    expect(canvasBox.height).toBeGreaterThan(300);
    expect(inside(el, 'aside').getBoundingClientRect().width).toBe(320);
  });

  it('lists the Manques, the lead first, each row its label, its meta, and leading to its block', async () => {
    const el = await show(withGap);
    expect(textOf(inside(panel(el), '.lead'))).toBe('Un Process qui a un Manque ne s’active pas. Chaque Manque mène à son bloc.');
    expect(tabs(el).map((tab) => textOf(tab))[0]).toBe('Manques1');
    const rows = [...panel(el).querySelectorAll<HTMLButtonElement>('button.gap')];
    expect(rows.map((row) => [textOf(row.querySelector('b')), textOf(row.querySelector('small'))])).toEqual([
      ['Entrée « Inventaire » de « Inventaire » : rien ne l’alimente', 'Inventaire · Idée'],
    ]);
    const details = await actionsOf(() => rows[0]?.click());
    expect(only(details)).toEqual([{ action: 'select', payload: { target: { kind: 'step', id: 'inventaire' }, centre: true } }]);
  });

  it('shows the Étape chosen: its kind and Phase, its Retour, its Entrées and Sorties folded, its Outils', async () => {
    const el = await show(review);
    expect(tabs(el).map((tab) => [textOf(tab), tab.getAttribute('aria-selected')])).toEqual([
      ['Manques0', 'false'],
      ['Étape', 'true'],
      ['Sources', 'false'],
    ]);
    const body = panel(el);
    expect((inside(body, 'cd-status-badge') as HTMLElement & { data: unknown }).data).toEqual({ tone: 'accent', label: 'Review' });
    expect(textOf(inside(body, '.kind'))).toBe('Agent · Développement');
    expect(textOf(inside(body, 'section.loop-back h2'))).toBe('Retour');
    expect(textOf(inside(body, 'section.loop-back p'))).toBe(review.step?.loopBack);
    const fold = inside<HTMLDetailsElement>(body, 'details.ports');
    expect(fold.open).toBe(false);
    expect(textOf(fold.querySelector('summary'))).toBe('Entrées et Sorties 2 → 1');
    expect([...fold.querySelectorAll('.item')].map(parts)).toEqual([
      ['Changement de code', '← Code', null],
      ['Verdict des checks', '← Checks', null],
      ['Verdict', '→ Merge', null],
    ]);
    expect([...inside(body, 'section.tools').querySelectorAll('.item')].map(parts)).toEqual([
      ['Rôle Review', null, 'Claude Code · Opus 5.5'],
      ['Skill review', null, 'officielle'],
    ]);
  });

  it('marks an Entrée nothing feeds, says « aucun Outil » without one, and leaves out the Retour without one', async () => {
    const step = { ...review.step!, loopBack: null, tools: [], inputs: [{ label: 'Inventaire', from: '← rien', fed: false }] };
    const el = await show({ ...review, step });
    const body = panel(el);
    expect(body.querySelector('section.loop-back')).toBeNull();
    const [input] = [...inside(body, 'details.ports').querySelectorAll('.item')];
    expect(input?.classList.contains('caution')).toBe(true);
    expect(textOf(inside(body, 'section.tools p'))).toBe('aucun Outil');
  });

  it('shows the Phase chosen, its tab « Phase »: its name, its counts, what it repeats', async () => {
    const el = await show(phase);
    expect(tabs(el).map((tab) => textOf(tab))).toEqual(['Manques0', 'Phase', 'Sources']);
    const body = panel(el);
    expect((inside(body, 'cd-status-badge') as HTMLElement & { data: unknown }).data).toEqual({ tone: 'accent', label: 'Développement' });
    expect(textOf(inside(body, '.kind'))).toBe('5 Étapes · 2 Retours');
    expect(textOf(inside(body, 'section.repeat p'))).toBe('Répéter : pour chaque Ticket prêt');
  });

  it('asks to choose an Étape or a Phase when nothing is', async () => {
    const el = await show({ ...active, tab: 'selection' });
    expect((inside(panel(el), 'cd-empty') as HTMLElement & { data: unknown }).data).toMatchObject({ title: 'Choisis une Étape ou une Phase sur le canevas.' });
  });

  it('shows the Sources: the lead, then each group, its place, what it holds and its Select', async () => {
    const el = await show(sources);
    const body = panel(el);
    expect(textOf(inside(body, '.lead'))).toBe(
      'Une Source par Type d’artefact : elle gagne toujours. Changer de Source migre tout ce qu’elle tient. GitHub : MaximeD1412/site-mairie.',
    );
    expect(body.querySelector('cd-banner')).toBeNull();
    expect([...body.querySelectorAll('.item')].map((item) => [icon(item), ...parts(item)])).toEqual([
      ['folder', 'Tickets', null, 'dossier tickets/ du Projet, sur atelier-pc'],
      ['github', 'Code et documents', null, 'MaximeD1412/site-mairie · Changement de code, Verdict, PRD, Maquettes, Conception technique ; Inventaire non utilisé'],
      ['bulb', 'Idée', 'Crewdeck', null],
    ]);
    const selects = [...body.querySelectorAll<SelectEl>('cd-select')];
    expect(selects.map((select) => [select.dataset['group'], select.data.label, select.data.value, select.data.state])).toEqual([
      ['ticket', 'Source des Tickets', 'local', null],
      ['code', 'Source du code et des documents', 'github', null],
    ]);
    expect(selects[0]!.data.options.map((option) => option.label)).toEqual(['Local', 'GitHub']);
  });

  it('asks to migrate a group when its Select changes, the Select back on its Source until the page says otherwise', async () => {
    const el = await show(sources);
    const select = inside<SelectEl>(panel(el), 'cd-select[data-group=ticket]');
    const native = inside<HTMLSelectElement>(select, 'select');
    const details = await actionsOf(() => {
      native.value = 'github';
      native.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      native.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    });
    expect(only(details)).toEqual([{ action: 'migrate', payload: { group: 'ticket', to: 'github' } }]);
    await settle(select);
    expect(select.value).toBe('local');
  });

  it('shows a migration running: its Banner, the badge and meta in place of the group’s Select, the other Select disabled', async () => {
    const el = await show(migrating);
    const body = panel(el);
    const banner = inside(body, 'cd-banner') as HTMLElement & { data: unknown };
    expect(banner.data).toEqual({ tone: 'caution', icon: 'refresh', title: 'Migration des Tickets vers GitHub' });
    expect(textOf(banner)).toBe('Aucun nouveau Ticket ne démarre. #12 et #14 finissent sur Local, puis les 30 Tickets passent sur GitHub d’un coup.');
    const [tickets, code] = [...body.querySelectorAll('.item')];
    expect(tickets!.classList.contains('caution')).toBe(true);
    expect((inside(tickets!, 'cd-status-badge') as HTMLElement & { data: unknown }).data).toEqual({ tone: 'caution', label: 'Local → GitHub' });
    expect(textOf(tickets!.querySelector('small'))).toBe('migration en cours · 2 Tickets à finir sur Local');
    expect(tickets!.querySelector('cd-select')).toBeNull();
    expect(inside<SelectEl>(code!, 'cd-select').data.state).toBe('disabled');
  });

  it('shows the versions at the panel’s foot', async () => {
    const el = await show(active);
    const foot = inside(el, 'footer.foot');
    expect(foot.getAttribute('aria-label')).toBe('Gestion du process / Versions');
    expect([...foot.querySelectorAll('p')].map((p) => textOf(p))).toEqual(['Aucun changement depuis la v3.', 'v3 active depuis le 4 nov.']);
  });

  it('says there is no active version yet under the header', async () => {
    const el = await show(noVersion);
    const banner = inside(el, 'cd-banner') as HTMLElement & { data: unknown };
    expect(banner.data).toEqual({ tone: 'caution', icon: 'alert', title: 'Pas encore de version active : règle les Manques puis active.' });
    expect(textOf(inside(el, 'footer.foot', 'p'))).toBe('Ce brouillon deviendra la v1.');
  });

  it('says « Ce Projet n’existe pas » for a Projet it does not know, with a link back to the Projets', async () => {
    const el = await show(notFound);
    expect(root(el).querySelector('.editor')).toBeNull();
    const empty = inside(el, 'cd-empty') as HTMLElement & { data: unknown };
    expect(empty.data).toMatchObject({ title: 'Ce Projet n’existe pas' });
    const link = empty.querySelector('a');
    expect(textOf(link)).toBe('Retour aux Projets');
    expect(link?.getAttribute('href')).toBe('/projets');
  });

  describe('relays', () => {
    it('the canvas’s selection, without centring it', async () => {
      const el = await show(active);
      const details = await actionsOf(() => inside(el, 'cd-process-canvas', 'cd-step-card[data-step=review]', 'article').click());
      expect(details.map(({ composant, action, payload }) => ({ composant, action, payload }))).toEqual([
        { composant: 'PageProcessEditor', action: 'select', payload: { target: { kind: 'step', id: 'review' }, centre: false } },
      ]);
    });

    it('the canvas’s view', async () => {
      const el = await show(active);
      const details = await actionsOf(async () => {
        inside(el, 'cd-process-canvas', 'cd-icon-button.zoom-in', 'button').click();
        await settle(el);
      });
      expect(details.map(({ composant, action }) => `${composant}.${action}`)).toEqual(['PageProcessEditor.view']);
      expect(details[0]?.payload).toMatchObject({ zoom: 100 });
    });

    it('a tab chosen', async () => {
      const el = await show(active);
      const details = await actionsOf(() => (tabs(el)[2] as HTMLButtonElement).click());
      expect(only(details)).toEqual([{ action: 'tab', payload: { tab: 'sources' } }]);
    });
  });

  it('does not render the editor below 1280 px: the Sources only, read', async () => {
    await page.viewport(390, 844);
    const el = await show(active);
    expect(textOf(inside(el, 'cd-page-header', 'h1'))).toBe('Gestion du process');
    expect(root(el).querySelector('.editor')).toBeNull();
    expect(textOf(inside(el, '.phone-sources h2'))).toBe('Sources');
    expect([...root(el).querySelectorAll('.phone-sources .item')].map((item) => parts(item).slice(0, 2))).toEqual([
      ['Tickets', 'Local'],
      ['Code et documents', 'GitHub'],
      ['Idée', 'Crewdeck'],
    ]);
    expect(root(el).querySelector('cd-select')).toBeNull();
    await page.viewport(1280, 800);
    await settle(el);
    await expect.poll(() => root(el).querySelector('.editor')).not.toBeNull();
  });

  it('shows a migration running on the phone: its Banner above the Sources, the row’s badge and meta', async () => {
    await page.viewport(390, 844);
    const el = await show(migrating);
    expect((inside(el, 'cd-banner.migration') as HTMLElement & { data: { title: string } }).data.title).toBe('Migration des Tickets vers GitHub');
    const tickets = inside(el, '.phone-sources .item.caution');
    expect((inside(tickets, 'cd-status-badge') as HTMLElement & { data: unknown }).data).toEqual({ tone: 'caution', label: 'Local → GitHub' });
    expect(textOf(tickets.querySelector('small'))).toBe('migration en cours · 2 Tickets à finir sur Local');
  });
});
