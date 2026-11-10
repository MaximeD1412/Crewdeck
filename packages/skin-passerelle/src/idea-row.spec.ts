/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

const { IdeaRow } = COMPOSANTS;

const ID = '0193a4f2-7c1e-7a10-8b2c-4d5e6f708193';
const analysed = {
  id: ID,
  title: 'Exporter le planning en PDF pour le client',
  meta: '#63 · Personal OS · il y a 2 h',
  state: 'analysee',
  summary: 'Un bouton qui produit le planning de la semaine en PDF, à envoyer au client.',
  impact: 'moyen',
  effort: 'faible',
  duplicates: 'doublon possible : #58',
  selected: false,
} as const;
const untriaged = { ...analysed, state: 'a-trier', summary: null, impact: null, effort: null, duplicates: null } as const;

const badgeOf = (el: Element) => inside(el, '.badge cd-status-badge') as HTMLElement & { data: { tone: string; label: string } };

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

describe('IdeaRow', () => {
  beforeEach(() => page.viewport(1280, 800));

  it.each([
    ['en-analyse', 'caution', 'En analyse'],
    ['a-trier', 'neutral', 'À trier'],
    ['analysee', 'accent', 'Analysée'],
    ['retenue', 'go', 'Retenue'],
    ['fusionnee', 'neutral', 'Fusionnée'],
    ['rejetee', 'halt', 'Rejetée'],
  ] as const)('shows the state %s in a %s badge « %s »', async (state, tone, label) => {
    const el = await render(IdeaRow, { ...analysed, state });
    expect(badgeOf(el).data).toEqual({ tone, label });
    expect(label).toBe(t(`ideaRow.state.${state}`));
  });

  it.each([
    ['en-analyse', 'spark'],
    ['analysee', 'bulb'],
    ['rejetee', 'bulb'],
  ] as const)('while %s, has the icon %s', async (state, icon) => {
    const el = await render(IdeaRow, { ...analysed, state });
    expect((inside(el, '.icon cd-icon') as HTMLElement & { data: { name: string } }).data.name).toBe(icon);
  });

  it('shows its title, meta, summary, and its facts: impact, effort and duplicates', async () => {
    const el = await render(IdeaRow, analysed);
    expect(textOf(inside(el, '.title'))).toBe(analysed.title);
    expect(textOf(inside(el, '.meta'))).toBe(analysed.meta);
    expect(textOf(inside(el, '.context'))).toBe(analysed.summary);
    expect([...(el.shadowRoot?.querySelectorAll('.facts span') ?? [])].map(textOf)).toEqual([
      'Impact moyen',
      'Effort faible',
      'doublon possible : #58',
    ]);
  });

  it('without an analysis, has neither summary nor facts', async () => {
    const el = await render(IdeaRow, untriaged);
    expect(el.shadowRoot?.querySelector('.context')).toBeNull();
    expect(el.shadowRoot?.querySelector('.facts')).toBeNull();
  });

  it('selected, is marked current', async () => {
    const el = await render(IdeaRow, { ...analysed, selected: true });
    expect(inside(el, '.open').getAttribute('aria-current')).toBe('true');
    expect(inside(el, '[part=row]').classList).toContain('selected');
    const other = await render(IdeaRow, analysed);
    expect(inside(other, '.open').hasAttribute('aria-current')).toBe(false);
  });

  it('is reached by Tab and emits open on Enter; its buttons stay its own', async () => {
    const el = await render(IdeaRow, untriaged, { actions: '<button type="button">Relancer l’analyse</button>' });
    await userEvent.tab();
    expect(await actionsOf(() => userEvent.keyboard('{Enter}'))).toEqual([
      { composant: 'IdeaRow', action: 'open', payload: { id: ID } },
    ]);
    await userEvent.tab();
    expect(textOf(document.activeElement)).toBe('Relancer l’analyse');
    expect(await actionsOf(() => userEvent.keyboard('{Enter}'))).toEqual([]);
    expect(await actionsOf(() => userEvent.click(el.querySelector('button') as HTMLElement))).toEqual([]);
  });

  it('hides the row of its buttons without buttons', async () => {
    const el = await render(IdeaRow, untriaged);
    expect(inside(el, '.actions').hidden).toBe(true);
  });

  it.each([390, 1280])('is 56 to 72 px tall at %i px for a one-line title', async (width) => {
    await page.viewport(width, 800);
    const el = await render(IdeaRow, { ...untriaged, title: 'Export PDF' });
    const { height } = inside(el, '[part=row]').getBoundingClientRect();
    expect(height).toBeGreaterThanOrEqual(56);
    expect(height).toBeLessThanOrEqual(72);
  });
});
