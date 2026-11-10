/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

const { TicketRow } = COMPOSANTS;

const ready = {
  number: 48,
  title: 'Agenda des conseils municipaux',
  meta: 'jalon Actualités',
  state: 'pret',
  label: null,
  context: null,
  href: null,
} as const;

const badgeOf = (el: Element) => inside(el, '.badge cd-status-badge') as HTMLElement & { data: { tone: string; label: string } };

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

describe('TicketRow', () => {
  beforeEach(() => page.viewport(1280, 800));

  it.each([
    ['pret', 'neutral', 'Prêt'],
    ['en-cours', 'accent', 'En cours'],
    ['en-review', 'accent', 'En review'],
    ['checks', 'accent', 'Checks'],
    ['bloque', 'halt', 'Bloqué'],
    ['revue-visuelle', 'caution', 'Revue visuelle'],
    ['interrompu', 'caution', 'Interrompu'],
    ['merge', 'go', 'Mergé'],
    ['attente', 'neutral', 'En attente'],
  ] as const)('shows the state %s in a %s badge « %s »', async (state, tone, label) => {
    const el = await render(TicketRow, { ...ready, state });
    expect(badgeOf(el).data).toEqual({ tone, label });
    expect(label).toBe(t(`ticketRow.state.${state}`));
  });

  it('with a label, shows it instead of its state’s, in its state’s tone', async () => {
    const el = await render(TicketRow, { ...ready, state: 'en-cours', label: 'Code' });
    expect(badgeOf(el).data).toEqual({ tone: 'accent', label: 'Code' });
  });

  it.each([
    ['bloque', 'halt'],
    ['interrompu', 'caution'],
    ['revue-visuelle', 'caution'],
    ['en-cours', null],
    ['merge', null],
    ['pret', null],
  ] as const)('while %s, has a rail of %s', async (state, tone) => {
    const el = await render(TicketRow, { ...ready, state });
    const probe = document.createElement('div');
    probe.style.background = tone ? `var(--cd-${tone})` : 'transparent';
    document.body.append(probe);
    expect(getComputedStyle(inside(el, '.rail')).backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
  });

  it('shows #<number> in mono, its title, meta and context', async () => {
    const el = await render(TicketRow, { ...ready, context: 'Le Runner s’est arrêté pendant le Code.' });
    const number = inside(el, '.number');
    expect(textOf(number)).toBe('#48');
    expect(getComputedStyle(number).fontFamily).toMatch(/Mono/);
    expect(textOf(inside(el, '.title'))).toBe(ready.title);
    expect(textOf(inside(el, '.meta'))).toBe(ready.meta);
    expect(textOf(inside(el, '.context'))).toBe('Le Runner s’est arrêté pendant le Code.');
  });

  it('without meta nor context, has neither line', async () => {
    const el = await render(TicketRow, { ...ready, meta: null });
    expect(el.shadowRoot?.querySelector('.meta')).toBeNull();
    expect(el.shadowRoot?.querySelector('.context')).toBeNull();
  });

  it('without href, has nothing to focus', async () => {
    const el = await render(TicketRow, ready);
    expect(el.shadowRoot?.querySelector('a, button')).toBeNull();
  });

  it('with href, is a link reached by Tab, named by its number and title; its buttons stay its own', async () => {
    const el = await render(TicketRow, { ...ready, href: '/boucle?ticket=48' }, { actions: '<button type="button">Reprendre</button>' });
    const link = inside<HTMLAnchorElement>(el, 'a.open');
    expect(link.getAttribute('href')).toBe('/boucle?ticket=48');
    expect(textOf(link)).toBe('#48 Agenda des conseils municipaux');
    expect(link.querySelector('button, a, slot')).toBeNull();
    await userEvent.tab();
    expect(el.shadowRoot?.activeElement).toBe(link);
    await userEvent.tab();
    expect(textOf(document.activeElement)).toBe('Reprendre');
  });

  it.each([390, 1280])('is 56 to 72 px tall at %i px for a one-line title', async (width) => {
    await page.viewport(width, 800);
    const el = await render(TicketRow, { ...ready, title: 'Agenda', state: 'revue-visuelle' });
    const { height } = inside(el, '[part=row]').getBoundingClientRect();
    expect(height).toBeGreaterThanOrEqual(56);
    expect(height).toBeLessThanOrEqual(72);
  });
});
