/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, emitAction, type ComposantData } from '@crewdeck/sdk';
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
const example = (name: string): Data => {
  const found = PageProcessEditor.examples.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`PageProcessEditor lacks its example « ${name} »`);
  return found.data as Data;
};
const active = example('la version active, sans Manque');
const withGap = example('un brouillon et son Manque');
const review = example('la Review choisie');
const phase = example('une Phase choisie');
const catalogue = example('le catalogue ouvert');
const refused = example('un déplacement refusé');
const removing = example('retirer une Phase');
const sources = example('les Sources');
const noVersion = example('sans version active');
const notFound = example('Projet introuvable');
const editable = (data: Data): Data => ({ ...data, canvas: { ...data.canvas, editable: true } });
type Control = HTMLElement & { value: string };

const show = async (data: Data) => render(PageProcessEditor, data);
const root = (el: Element) => el.shadowRoot!;
const tabs = (el: Element) => [...(inside(el, 'cd-tabs').shadowRoot?.querySelectorAll('button[role=tab]') ?? [])];
const panel = (el: Element) => inside(el, '.panel-body');
const parts = (item: Element) => ['b', '.mono', 'small'].map((part) => textOf(item.querySelector(part)) ?? null);
const only = (details: { action: string; payload: unknown }[]) => details.map(({ action, payload }) => ({ action, payload }));

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

  it('shows the Phase chosen, its tab « Phase »: its badge and counts, its name, « Répéter », its help, why it stays', async () => {
    const el = await show(phase);
    expect(tabs(el).map((tab) => textOf(tab))).toEqual(['Manques0', 'Phase', 'Sources']);
    const body = panel(el);
    expect((inside(body, 'cd-status-badge') as HTMLElement & { data: unknown }).data).toEqual({ tone: 'accent', label: 'Phase' });
    expect(textOf(inside(body, '.kind'))).toBe('5 Étapes · 2 Retours');
    const name = inside(body, 'cd-text-field.phase-name') as Control & { data: { label: string } };
    expect(name.data.label).toBe('Nom de la Phase');
    expect(name.value).toBe('Développement');
    expect(textOf(inside(body, 'section.repeat h2'))).toBe('Répéter');
    expect(inside(body, 'section.repeat [role=radiogroup]').getAttribute('aria-label')).toBe('Répéter');
    const radios = [...body.querySelectorAll('cd-radio')] as (HTMLElement & { data: { label: string; checked: boolean; value: string } })[];
    expect(radios.map((radio) => [radio.data.label, radio.data.value, radio.data.checked])).toEqual([
      ['Une fois', 'once', false],
      ['Pour chaque Idée notée', 'idea.noted', false],
      ['Pour chaque Idée retenue', 'idea.retained', false],
      ['Pour chaque Ticket prêt', 'ticket.ready', true],
    ]);
    expect(textOf(inside(body, 'section.repeat .help'))).toBe('Chaque Ticket prêt parcourt la Phase : c’est la Boucle.');
    const remove = inside(body, 'cd-button.remove-phase') as HTMLElement & { data: unknown };
    expect(remove.data).toMatchObject({ label: 'Retirer la Phase', variant: 'ghost', icon: 'trash', state: 'disabled', disabledReason: 'Elle tient la Review et le Merge, qui ne se retirent pas.' });
    expect(textOf(inside(remove, '.reason'))).toBe('Elle tient la Review et le Merge, qui ne se retirent pas.');
  });

  it('shows a refused name under its field', async () => {
    const el = await show({ ...phase, phase: { ...phase.phase!, nameError: 'Une Phase porte déjà ce nom.' } });
    expect(textOf(inside(panel(el), 'cd-text-field.phase-name', '.error'))).toBe('Une Phase porte déjà ce nom.');
  });

  it('focuses the name of a Phase just added, once per ask', async () => {
    const el = await show({ ...phase, phase: { ...phase.phase!, focusName: 1 } });
    const input = () => inside(panel(el), 'cd-text-field.phase-name', 'input');
    await expect.poll(() => input().matches(':focus')).toBe(true);
    input().blur();
    el.data = { ...phase, phase: { ...phase.phase!, focusName: 1, count: '5 Étapes' } };
    await settle(el);
    expect(input().matches(':focus')).toBe(false);
    el.data = { ...phase, phase: { ...phase.phase!, focusName: 2 } };
    await settle(el);
    await expect.poll(() => input().matches(':focus')).toBe(true);
  });

  it('reads only, without « Phase », « Étape », « Retirer » nor fields, while the canvas is not editable', async () => {
    const el = await show(review);
    expect(inside(el, 'cd-page-header').querySelector('.header-actions')).toBeNull();
    expect(panel(el).querySelector('cd-button, cd-select')).toBeNull();
  });

  it('asks to choose an Étape or a Phase when nothing is', async () => {
    const el = await show({ ...active, tab: 'selection' });
    expect((inside(panel(el), 'cd-empty') as HTMLElement & { data: unknown }).data).toMatchObject({ title: 'Choisis une Étape ou une Phase sur le canevas.' });
  });

  it('shows the Sources: the lead, then each group, its place and what it holds', async () => {
    const el = await show(sources);
    const body = panel(el);
    expect(textOf(inside(body, '.lead'))).toBe('Une Source par Type d’artefact : elle gagne toujours.');
    const icon = (item: Element) => (item.querySelector('cd-icon') as HTMLElement & { data: { name: string } }).data.name;
    expect([...body.querySelectorAll('.item')].map((item) => [icon(item), ...parts(item)])).toEqual([
      ['folder', 'Tickets', 'Local', 'dossier tickets/ du Projet, sur atelier-pc'],
      ['github', 'Code et documents', 'GitHub', 'MaximeD1412/site-mairie · Changement de code, Verdict, PRD, Maquettes, Conception technique ; Inventaire non utilisé'],
      ['bulb', 'Idée', 'Crewdeck', null],
    ]);
    expect(body.querySelector('cd-select, select')).toBeNull();
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

  describe('editable', () => {
    const native = <E extends Element>(el: Element, ...selectors: string[]) => inside<E>(el, ...selectors);
    const type = (input: HTMLInputElement | HTMLSelectElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    };

    it('puts « Phase » and « Étape » in the header, the catalogue’s Menu under « Étape » while open', async () => {
      const el = await show(phase);
      const buttons = [...inside(el, 'cd-page-header').querySelectorAll('.header-actions cd-button')] as (HTMLElement & { data: unknown })[];
      expect(buttons.map((button) => button.data)).toEqual([
        { label: 'Phase', variant: 'secondary', size: 'sm', icon: 'plus' },
        { label: 'Étape', variant: 'secondary', size: 'sm', icon: 'plus' },
      ]);
      expect(root(el).querySelector('cd-menu')).toBeNull();
      expect(buttons[1]?.getAttribute('aria-expanded')).toBe('false');

      const open = await show(catalogue);
      const menu = inside(open, '.menu-anchor cd-menu') as HTMLElement & { data: unknown };
      expect(menu.data).toEqual(catalogue.catalogue);
      const step = inside(open, 'cd-button.add-step');
      expect(step.getAttribute('aria-expanded')).toBe('true');
      const [menuBox, stepBox] = [menu.getBoundingClientRect(), step.getBoundingClientRect()];
      expect(menuBox.top).toBeGreaterThan(stepBox.bottom);
      expect(Math.round(menuBox.right)).toBe(Math.round(stepBox.right));
      // Its own width, opening leftwards: not the button's.
      expect(Math.round(menuBox.width)).toBe(Math.round(Number.parseFloat(getComputedStyle(menu).width)));
      expect(menuBox.width).toBeGreaterThan(stepBox.width * 2);
    });

    it('relays « Phase » and « Étape »', async () => {
      const el = await show(phase);
      const details = await actionsOf(() => {
        native<HTMLButtonElement>(el, 'cd-button.add-phase', 'button').click();
        native<HTMLButtonElement>(el, 'cd-button.add-step', 'button').click();
      });
      expect(only(details)).toEqual([
        { action: 'addPhase', payload: {} },
        { action: 'openCatalogue', payload: {} },
      ]);
    });

    it('relays the kind chosen in the catalogue, and its closing', async () => {
      const el = await show(catalogue);
      const chosen = await actionsOf(() => native<HTMLElement>(el, 'cd-menu', '[role=menuitem]').click());
      expect(only(chosen).filter(({ action }) => action !== 'close')).toEqual([{ action: 'addStep', payload: { kind: 'idea-analysis' } }]);
      const closed = await actionsOf(() => native<HTMLElement>(el, 'cd-menu', '[role=menu]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })));
      expect(only(closed)).toEqual([{ action: 'closeMenu', payload: {} }]);
    });

    it('does not open the catalogue again when « Étape » is pressed to close it', async () => {
      const el = await show(catalogue);
      const button = native<HTMLButtonElement>(el, 'cd-button.add-step', 'button');
      const details = await actionsOf(() => {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        button.click();
      });
      expect(only(details).map(({ action }) => action)).toEqual(['closeMenu']);
    });

    it('shows a refusal as the canvas’s Toast', async () => {
      const el = await show(refused);
      const toast = inside(el, 'cd-process-canvas > cd-toast[slot=toast]') as HTMLElement & { data: unknown };
      expect(toast.data).toEqual(refused.toast);
      expect(root(await show(phase)).querySelector('cd-toast')).toBeNull();
    });

    it('relays a card dropped on a cell', async () => {
      const el = await show(phase);
      const canvas = inside(el, 'cd-process-canvas');
      const details = await actionsOf(() => emitAction(canvas, COMPOSANTS.ProcessCanvas, 'moveStep', { stepId: 'review', phaseId: 'ph-dev', col: 3, row: 1 }));
      expect(details.map(({ composant, action, payload }) => ({ composant, action, payload }))).toEqual([
        { composant: 'PageProcessEditor', action: 'moveStep', payload: { stepId: 'review', phaseId: 'ph-dev', col: 3, row: 1 } },
      ]);
    });

    it('offers the Étape’s « Retirer », disabled with its reason, and its Select « Phase »', async () => {
      const el = await show(editable(review));
      const body = panel(el);
      expect((inside(body, 'cd-button.remove-step') as HTMLElement & { data: unknown }).data).toMatchObject({ label: 'Retirer', icon: 'trash', state: 'disabled' });
      expect(textOf(inside(body, '.reason'))).toBe('La Review ne se retire pas : son Rôle se change.');
      const select = inside(body, 'cd-select.step-phase') as Control & { data: { label: string; options: { label: string }[] } };
      expect(select.data.label).toBe('Phase');
      expect(select.value).toBe('ph-dev');
      expect(select.data.options.map((option) => option.label)).toEqual(['Idée', 'Conception', 'Développement']);
    });

    it('relays « Retirer » and another Phase chosen for the Étape', async () => {
      const el = await show(editable({ ...review, step: { ...review.step!, removeReason: null } }));
      const body = panel(el);
      expect(body.querySelector('.reason')).toBeNull();
      const details = await actionsOf(() => {
        const select = native<HTMLSelectElement>(body, 'cd-select.step-phase', 'select');
        type(select, 'ph-idee');
        select.dispatchEvent(new Event('change'));
        native<HTMLButtonElement>(body, 'cd-button.remove-step', 'button').click();
      });
      expect(only(details)).toEqual([
        { action: 'moveStepToPhase', payload: { stepId: 'review', phaseId: 'ph-idee' } },
        { action: 'removeStep', payload: { stepId: 'review' } },
      ]);
    });

    it('relays the name typed, on Enter or on leaving the field, once', async () => {
      const el = await show(phase);
      const input = native<HTMLInputElement>(panel(el), 'cd-text-field.phase-name', 'input');
      const details = await actionsOf(() => {
        type(input, 'Livraison');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change'));
        type(input, 'Livraison 2');
        input.dispatchEvent(new Event('change'));
      });
      expect(only(details)).toEqual([
        { action: 'renamePhase', payload: { phaseId: 'ph-dev', name: 'Livraison' } },
        { action: 'renamePhase', payload: { phaseId: 'ph-dev', name: 'Livraison 2' } },
      ]);
    });

    it('relays « Répéter » checked: « Une fois » as null', async () => {
      const el = await show(phase);
      const radios = [...panel(el).querySelectorAll('cd-radio')];
      const details = await actionsOf(() => {
        native<HTMLInputElement>(radios[0]!, 'input').click();
        native<HTMLInputElement>(radios[2]!, 'input').click();
      });
      expect(only(details)).toEqual([
        { action: 'setForEach', payload: { phaseId: 'ph-dev', forEach: null } },
        { action: 'setForEach', payload: { phaseId: 'ph-dev', forEach: 'idea.retained' } },
      ]);
    });

    it('draws a refused choice again from the data: the radio the Phase holds checked and focused, the Select on the Étape’s Phase', async () => {
      const el = await show(phase);
      const first = native<HTMLInputElement>(panel(el).querySelector('cd-radio')!, 'input');
      first.focus();
      first.click();
      await vi.waitFor(() => {
        const radios = [...panel(el).querySelectorAll('cd-radio')] as (HTMLElement & { checked: boolean; data: { checked: boolean } })[];
        expect(radios.map((radio) => radio.checked)).toEqual(radios.map((radio) => radio.data.checked));
        expect(radios.find((radio) => radio.data.checked)?.shadowRoot?.activeElement?.localName).toBe('input');
      });

      const other = await show(editable({ ...review, step: { ...review.step!, removeReason: null } }));
      const select = native<HTMLSelectElement>(panel(other), 'cd-select.step-phase', 'select');
      type(select, 'ph-idee');
      select.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(native<HTMLSelectElement>(panel(other), 'cd-select.step-phase', 'select').value).toBe('ph-dev'));
    });

    it('relays « Retirer la Phase » when it may go', async () => {
      const el = await show({ ...phase, phase: { ...phase.phase!, removeReason: null } });
      const details = await actionsOf(() => native<HTMLButtonElement>(panel(el), 'cd-button.remove-phase', 'button').click());
      expect(only(details)).toEqual([{ action: 'removePhase', payload: { phaseId: 'ph-dev' } }]);
    });

    it('asks in a Dialog before removing a Phase with its Étapes: « Annuler », or « Retirer la Phase »', async () => {
      const el = await show(removing);
      const dialog = inside(el, 'cd-dialog.remove-phase-dialog') as HTMLElement & { data: unknown };
      expect(dialog.data).toEqual({ open: true, title: 'Retirer la Phase « Développement » ?' });
      expect(textOf(dialog.querySelector('p'))).toBe('Ses 2 Étapes partent avec elle : Code, Revue visuelle. Le changement va dans le brouillon.');
      expect((dialog.querySelector('cd-button.confirm') as HTMLElement & { data: unknown }).data).toMatchObject({ label: 'Retirer la Phase', variant: 'danger' });
      const details = await actionsOf(() => {
        native<HTMLButtonElement>(dialog.querySelector('cd-button.cancel')!, 'button').click();
        native<HTMLButtonElement>(dialog.querySelector('cd-button.confirm')!, 'button').click();
        native<HTMLButtonElement>(dialog, 'cd-icon-button', 'button').click();
      });
      expect(only(details)).toEqual([
        { action: 'cancelRemovePhase', payload: {} },
        { action: 'confirmRemovePhase', payload: { phaseId: 'ph-dev' } },
        { action: 'cancelRemovePhase', payload: {} },
      ]);
      expect((inside(await show(phase), 'cd-dialog') as HTMLElement & { data: { open: boolean } }).data.open).toBe(false);
    });
  });

  it('does not render the editor below 1280 px', async () => {
    await page.viewport(390, 844);
    const el = await show(active);
    expect(textOf(inside(el, 'cd-page-header', 'h1'))).toBe('Gestion du process');
    expect(root(el).querySelector('.editor')).toBeNull();
    await page.viewport(1280, 800);
    await settle(el);
    await expect.poll(() => root(el).querySelector('.editor')).not.toBeNull();
  });
});
