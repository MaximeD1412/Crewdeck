/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

const { DecisionRow } = COMPOSANTS;

const ID = '0193a4f2-7c1e-7a10-8b2c-4d5e6f708192';
const blocked = {
  id: ID,
  kind: 'Ticket bloqué',
  title: '#42 Connexion GitHub',
  meta: 'Crewdeck · Code · il y a 4 min',
  context: 'L’agent ne trouve pas comment tester le renouvellement du jeton.',
  tone: 'halt',
  icon: 'block',
} as const;

const SLOTS = {
  actions: '<button type="button">Attendre</button><button type="button">Passer sur Codex</button>',
  badges: '<span class="signal">2e blocage</span>',
};

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

describe('DecisionRow', () => {
  beforeEach(() => page.viewport(1280, 800));

  it('shows its kind before its title, its meta and its context', async () => {
    const el = await render(DecisionRow, blocked);
    expect(textOf(inside(el, '.title'))).toBe('Ticket bloqué · #42 Connexion GitHub');
    expect(textOf(inside(el, '.meta'))).toBe('Crewdeck · Code · il y a 4 min');
    expect(textOf(inside(el, '.context'))).toBe(blocked.context);
  });

  it('without a context, has no context line', async () => {
    const el = await render(DecisionRow, { ...blocked, context: null });
    expect(el.shadowRoot?.querySelector('.context')).toBeNull();
  });

  it('places the page’s buttons in its actions Emplacement and its signals in badges, beside the title', async () => {
    const el = await render(DecisionRow, blocked, SLOTS);
    const assigned = (name: string) =>
      inside<HTMLSlotElement>(el, `slot[name=${name}]`)
        .assignedElements()
        .map((node) => textOf(node));
    expect(assigned('actions')).toEqual(['Attendre', 'Passer sur Codex']);
    expect(assigned('badges')).toEqual(['2e blocage']);
    expect(inside(el, '.title-line slot[name=badges]')).toBeDefined();
  });

  it('is reached by Tab and emits open on Enter', async () => {
    const el = await render(DecisionRow, blocked);
    await userEvent.tab();
    expect(el.shadowRoot?.activeElement).not.toBeNull();
    const details = await actionsOf(() => userEvent.keyboard('{Enter}'));
    expect(details).toEqual([{ composant: 'DecisionRow', action: 'open', payload: { id: ID } }]);
  });

  it('keeps its buttons focusable on their own: Enter on one of them does not open the row', async () => {
    const el = await render(DecisionRow, blocked, SLOTS);
    await userEvent.tab();
    await userEvent.tab();
    expect(textOf(document.activeElement)).toBe('Attendre');
    const pressed = vi.fn();
    el.querySelector('button')?.addEventListener('click', pressed);
    const details = await actionsOf(() => userEvent.keyboard('{Enter}'));
    expect(pressed).toHaveBeenCalledOnce();
    expect(details).toEqual([]);
  });

  it('opens on a click anywhere on it outside its buttons', async () => {
    const el = await render(DecisionRow, blocked, SLOTS);
    expect(await actionsOf(() => userEvent.click(inside(el, '.meta'), { force: true }))).toEqual([
      { composant: 'DecisionRow', action: 'open', payload: { id: ID } },
    ]);
    expect(await actionsOf(() => userEvent.click(el.querySelector('button') as HTMLElement))).toEqual([]);
  });

  it('has no interactive element inside another', async () => {
    const el = await render(DecisionRow, blocked, SLOTS);
    for (const control of el.shadowRoot?.querySelectorAll('button, a') ?? []) {
      expect(control.querySelector('button, a, slot')).toBeNull();
    }
  });

  it('below 1280 px, keeps its buttons for the opened Décision and shows a chevron instead', async () => {
    await page.viewport(390, 844);
    const el = await render(DecisionRow, blocked, SLOTS);
    expect(el.querySelector('button')?.checkVisibility()).toBe(false);
    expect(inside(el, '.chevron').checkVisibility()).toBe(true);
    await page.viewport(1280, 800);
    expect(el.querySelector('button')?.checkVisibility()).toBe(true);
    expect(inside(el, '.chevron').checkVisibility()).toBe(false);
  });

  it.each([390, 1280])('is 56 to 72 px tall at %i px for a one-line title', async (width) => {
    await page.viewport(width, 800);
    const el = await render(DecisionRow, { ...blocked, title: '#42', context: null }, { actions: SLOTS.actions });
    const { height } = inside(el, '[part=row]').getBoundingClientRect();
    expect(height).toBeGreaterThanOrEqual(56);
    expect(height).toBeLessThanOrEqual(72);
  });
});
