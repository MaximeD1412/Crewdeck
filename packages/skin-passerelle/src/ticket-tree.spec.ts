/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const node = (number: number, depth: number, extra: Partial<{ blockedBy: string; critical: boolean; href: string }> = {}) => ({
  number,
  title: `Ticket ${number}`,
  state: 'attente',
  depth,
  blockedBy: extra.blockedBy ?? null,
  critical: extra.critical ?? false,
  href: extra.href ?? null,
});

const nodes = [
  { ...node(51, 0, { critical: true }), state: 'interrompu' },
  node(56, 1, { blockedBy: '#51', critical: true }),
  node(57, 2, { blockedBy: '#56', critical: true }),
  { ...node(38, 0, { href: '/tickets/38' }), state: 'revue-visuelle' },
];

const items = (el: Element) => [...(el.shadowRoot?.querySelectorAll('ul > li') ?? [])] as HTMLElement[];
const title = (li: Element) => li.querySelector('.title') as HTMLElement;

describe('TicketTree', () => {
  it('is a list of its Tickets, each with its number, its title and its state', async () => {
    const el = await render(COMPOSANTS.TicketTree, { nodes });
    expect(items(el).map((li) => textOf(li.querySelector('.number')))).toEqual(['#51', '#56', '#57', '#38']);
    expect(textOf(title(items(el)[0] as HTMLElement).querySelector('.name'))).toBe('Ticket 51');
    const badge = items(el)[0]?.querySelector('cd-status-badge') as Element & { data: unknown };
    expect(badge.data).toEqual({ tone: 'caution', label: 'Interrompu' });
  });

  it('indents each Ticket by its depth', async () => {
    const el = await render(COMPOSANTS.TicketTree, { nodes });
    const [root, child, grandchild, other] = items(el);
    expect(items(el).map((li) => li.getAttribute('aria-level'))).toEqual(['1', '2', '3', '1']);
    const left = (li?: HTMLElement) => li?.querySelector('.number')?.getBoundingClientRect().left ?? NaN;
    expect(left(child)).toBeGreaterThan(left(root));
    expect(left(grandchild) - left(child)).toBeCloseTo(left(child) - left(root), 0);
    expect(left(other)).toBeCloseTo(left(root), 0);
  });

  it('says what blocks a Ticket', async () => {
    const el = await render(COMPOSANTS.TicketTree, { nodes });
    expect(textOf(items(el)[1]?.querySelector('.blocked'))).toBe('bloqué par #51');
    expect(items(el)[0]?.querySelector('.blocked')).toBeNull();
  });

  it('puts the critical path in bold, says it, and explains it under the tree', async () => {
    const el = await render(COMPOSANTS.TicketTree, { nodes });
    const weight = (li?: HTMLElement) => Number(getComputedStyle(li?.querySelector('.name') as Element).fontWeight);
    expect(weight(items(el)[0])).toBeGreaterThanOrEqual(600);
    expect(weight(items(el)[3])).toBeLessThan(600);
    expect(textOf(items(el)[0]?.querySelector('.visually-hidden'))).toBe('chemin critique');
    expect(items(el)[3]?.querySelector('.visually-hidden')).toBeNull();
    expect(textOf(inside(el, '.caption'))).toBe('En gras : le chemin critique.');
  });

  it('has no caption without a critical path', async () => {
    const el = await render(COMPOSANTS.TicketTree, { nodes: [node(38, 0)] });
    expect(el.shadowRoot?.querySelector('.caption')).toBeNull();
  });

  it('makes the title of a Ticket with an address its link', async () => {
    const el = await render(COMPOSANTS.TicketTree, { nodes });
    const link = items(el)[3]?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/tickets/38');
    expect(textOf(link)).toBe('Ticket 38');
    expect(items(el)[0]?.querySelector('a')).toBeNull();
  });
});
