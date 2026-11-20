/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { page } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

const { PageIdee } = COMPOSANTS;
const [analysed, analysing, failed, bare] = PageIdee.examples;
if (!analysed || !analysing || !failed || !bare) throw new Error('PageIdee lacks its examples');

beforeAll(defineSkin);
afterEach(async () => {
  document.body.replaceChildren();
  await page.viewport(1280, 800);
});

describe('PageIdee', () => {
  it('titles the page by the Idée, back to « Idées », its number and state counted, its Emplacement actions in the header', async () => {
    const el = await render(PageIdee, analysed.data, { actions: '<button class="mine">Retenir</button>' });
    expect(textOf(inside(el, 'cd-page-header', 'h1'))).toBe('Exporter le planning en PDF pour le client');
    expect(textOf(inside(el, 'cd-page-header', '.count'))).toBe('#63 · Analysée');
    expect(inside(el, 'cd-page-header', 'a').getAttribute('href')).toBe('/idees');
    expect(textOf(inside(el, 'cd-page-header', 'a'))).toContain('Idées');
    const slot = inside<HTMLSlotElement>(el, 'slot[name="actions"]');
    expect(slot.assignedElements().map((node) => node.className)).toEqual(['mine']);
  });

  it('shows the text noted between quotes, how and when', async () => {
    const el = await render(PageIdee, analysed.data);
    const noted = inside(el, 'cd-card.noted');
    expect(textOf(inside(noted, 'h2'))).toBe('Notée');
    expect(textOf(noted.querySelector('.said'))).toBe('« Pouvoir exporter le planning en PDF pour l’envoyer au client. »');
    expect(textOf(noted.querySelector('.how'))).toBe('par toi · au téléphone, dictée · il y a 2 h');
  });

  it('keeps the lines of a text noted on several', async () => {
    const el = await render(PageIdee, { ...analysed.data, noted: { ...analysed.data.noted, text: 'Exporter le planning\nen PDF' } });
    const said = inside(el, 'cd-card.noted').querySelector('.said') as HTMLElement;
    const oneLine = parseFloat(getComputedStyle(said).lineHeight);
    expect(said.getBoundingClientRect().height).toBeGreaterThanOrEqual(oneLine * 2 - 1);
  });

  it('shows its analysis, whose actions bubble up as they are', async () => {
    const el = await render(PageIdee, failed.data);
    const analysis = inside(el, 'cd-idea-analysis');
    expect(textOf(inside(analysis, 'cd-card', 'h2'))).toBe('Analyse');
    expect(await actionsOf(() => inside(analysis, 'cd-button.reanalyse', 'button').click())).toEqual([
      { composant: 'IdeaAnalysis', action: 'reanalyse', payload: { id: failed.data.analysis?.id } },
    ]);
  });

  it('without an analysis, shows no Card « Analyse »', async () => {
    const el = await render(PageIdee, bare.data);
    expect(el.shadowRoot?.querySelector('cd-idea-analysis')).toBeNull();
    expect(el.shadowRoot?.querySelector('cd-card.noted')).not.toBeNull();
  });

  it('lists the possible duplicates beside the main column from 1280 px, each a link to its page with its badge, stacked on a phone', async () => {
    const el = await render(PageIdee, analysed.data);
    const card = inside(el, 'cd-card.duplicates');
    expect(textOf(inside(card, 'h2'))).toBe('Doublons possibles1');
    const row = inside(el, 'cd-card.duplicates cd-list-row');
    expect(inside(row, 'a').getAttribute('href')).toBe('/idees/0193a4f2-7c1e-7a10-8c2c-000000000058');
    expect(textOf(inside(row, 'a'))).toContain('#58 Imprimer le planning de la semaine');
    expect((row.querySelector('cd-status-badge') as HTMLElement & { data: { tone: string; label: string } }).data).toEqual({ tone: 'accent', label: 'Analysée' });
    expect(card.getBoundingClientRect().left).toBeGreaterThan(inside(el, 'cd-card.noted').getBoundingClientRect().right);

    await page.viewport(390, 800);
    await settle(el);
    expect(card.getBoundingClientRect().top).toBeGreaterThan(inside(el, 'cd-idea-analysis').getBoundingClientRect().bottom - 1);
  });

  it('without a duplicate, has no Card « Doublons possibles »', async () => {
    const el = await render(PageIdee, analysing.data);
    expect(el.shadowRoot?.querySelector('cd-card.duplicates')).toBeNull();
  });
});
