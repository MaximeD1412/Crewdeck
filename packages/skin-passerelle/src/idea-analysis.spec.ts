/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

const { IdeaAnalysis } = COMPOSANTS;
const example = (name: string) => {
  const found = IdeaAnalysis.examples.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`IdeaAnalysis lacks « ${name} »`);
  return found;
};
const passed = example('analysée, sur sa page');
const aside = example('analysée, à côté de la liste');
const incomplete = example('son Contrat incomplet');
const running = example('en cours');
const waiting = example('en attente du Runner');

/** Each fact of the `<dl>`, its label then its value. */
const facts = (el: Element) =>
  [...(el.shadowRoot?.querySelectorAll('dt') ?? [])].map((dt) => `${textOf(dt)} | ${textOf(dt.nextElementSibling as HTMLElement)}`);
const none = (el: Element, selector: string) => el.shadowRoot?.querySelector(selector) ?? null;

beforeAll(defineSkin);
afterEach(async () => {
  document.body.replaceChildren();
  await page.viewport(1280, 800);
});

describe('IdeaAnalysis', () => {
  it('shows the summary, the Projet visé with « Changer », the impact and the effort with their reasons, then the Rôle and the Moteur', async () => {
    const el = await render(IdeaAnalysis, passed.data);
    expect(textOf(inside(el, 'cd-card', 'h2'))).toBe('Analyse');
    expect(inside(el, 'cd-card', 'section').getAttribute('aria-label')).toBe('Une Idée / Analyse');
    expect(none(el, '.heading')).toBeNull();
    expect(textOf(inside(el, '.summary'))).toBe(passed.data.summary);
    expect(facts(el)).toEqual([
      'Projet visé | Personal OS',
      'Impact | moyen : le client le demande à chaque fin de semaine',
      'Effort | faible : le planning existe déjà, seul l’export manque',
    ]);
    expect(textOf(inside(el, '.run'))).toBe('Rôle Idée · Claude Code · il y a 2 h');
    expect(none(el, 'cd-banner')).toBeNull();
    expect(none(el, 'cd-button.reanalyse')).toBeNull();
  });

  it('beside the list, heads it with the Idée’s title and links each possible duplicate to its page', async () => {
    const el = await render(IdeaAnalysis, aside.data);
    expect(textOf(inside(el, 'cd-card', 'h2'))).toBe('Analyse · #63');
    expect(textOf(inside(el, '.heading'))).toBe('Exporter le planning en PDF pour le client');
    expect(facts(el)).toEqual(['Projet visé | Personal OS', 'Impact | moyen', 'Effort | faible', 'Doublon possible | #58 Imprimer le planning de la semaine']);
    expect(inside<HTMLAnchorElement>(el, 'a.duplicate').getAttribute('href')).toBe('/idees/0193a4f2-7c1e-7a10-8c2c-000000000058');
    expect(none(el, '.run')).toBeNull();
  });

  it('« Changer » opens the Pilote’s Projets and « nouveau », the Projet visé checked; a choice emits target, null for « nouveau »', async () => {
    const el = await render(IdeaAnalysis, passed.data);
    expect(none(el, 'cd-menu')).toBeNull();
    const change = inside(el, 'cd-button.change');
    expect(change.getAttribute('aria-expanded')).toBe('false');
    inside(change, 'button').click();
    await settle(el);
    expect(change.getAttribute('aria-expanded')).toBe('true');
    const items = () => [...(inside(el, 'cd-menu').shadowRoot?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    expect(items().map((item) => textOf(inside(item, 'b')))).toEqual(['Crewdeck', 'Personal OS', 'nouveau']);
    expect(items().map((item) => item.classList.contains('selected'))).toEqual([false, true, false]);

    expect(await actionsOf(() => items()[0]?.click())).toEqual([
      { composant: 'IdeaAnalysis', action: 'target', payload: { id: passed.data.id, projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01' } },
    ]);
    await settle(el);
    expect(none(el, 'cd-menu')).toBeNull();

    inside(el, 'cd-button.change', 'button').click();
    await settle(el);
    expect(await actionsOf(() => items()[2]?.click())).toEqual([{ composant: 'IdeaAnalysis', action: 'target', payload: { id: passed.data.id, projectId: null } }]);
  });

  it('closes the Menu on Escape, emitting nothing of its own', async () => {
    const el = await render(IdeaAnalysis, passed.data);
    inside(el, 'cd-button.change', 'button').click();
    await settle(el);
    expect(await actionsOf(() => userEvent.keyboard('{Escape}'))).toEqual([]);
    await settle(el);
    expect(none(el, 'cd-menu')).toBeNull();
  });

  it('failed, says so in a halt Banner listing the rules not met and the Décision, then « Relancer l’analyse », which emits reanalyse', async () => {
    const el = await render(IdeaAnalysis, incomplete.data, { actions: '<button>Rejeter</button>' });
    const banner = inside(el, 'cd-banner.failure') as HTMLElement & { data: { tone: string; title: string } };
    expect(banner.data).toMatchObject({ tone: 'halt', title: 'Analyse échouée' });
    expect([...banner.querySelectorAll('li')].map((li) => textOf(li))).toEqual([
      'Le rapport a un titre et un résumé d’au plus 400 caractères',
      'L’impact et l’effort vont de 1 à 5, chacun avec sa raison',
    ]);
    expect(textOf(banner)).toContain('Une Décision « Contrat incomplet » t’attend aussi dans « À toi ».');
    expect(textOf(inside(el, '.run'))).toBe('Rôle Idée · Claude Code · il y a 4 min');
    expect(none(el, 'dl')).toBeNull();
    expect(textOf(inside(el, 'cd-button.reanalyse', 'button'))).toBe('Relancer l’analyse');
    expect(textOf(inside(el, '.without'))).toBe('Tu peux aussi la trier sans analyse :');
    expect(inside(el, '.without').getBoundingClientRect().bottom).toBeLessThanOrEqual(inside(el, '.actions').getBoundingClientRect().top + 1);
    expect(await actionsOf(() => inside(el, 'cd-button.reanalyse', 'button').click())).toEqual([
      { composant: 'IdeaAnalysis', action: 'reanalyse', payload: { id: incomplete.data.id } },
    ]);
  });

  it('failed by its Session, names the Décision « Étape échouée »; without triage buttons, no sentence leads to them', async () => {
    const el = await render(IdeaAnalysis, { ...incomplete.data, failure: { kind: 'failed', rules: [] } });
    const banner = inside(el, 'cd-banner.failure');
    expect(banner.querySelector('ul')).toBeNull();
    expect(textOf(banner)).toContain('Une Décision « Étape échouée » t’attend aussi dans « À toi ».');
    expect(none(el, '.without')).toBeNull();
    expect(inside(el, '.actions').hidden).toBe(true);
  });

  it('running, says « L’analyse est en cours. »; waiting, « En attente du Runner »', async () => {
    const el = await render(IdeaAnalysis, running.data);
    expect(textOf(inside(el, '.running'))).toBe('L’analyse est en cours.');
    expect(none(el, 'dl')).toBeNull();
    const parked = await render(IdeaAnalysis, waiting.data);
    expect((inside(parked, 'cd-banner.waiting') as HTMLElement & { data: { title: string } }).data.title).toBe('En attente du Runner');
    expect(none(parked, '.running')).toBeNull();
  });
});
