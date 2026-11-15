import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const { Port } = COMPOSANTS;
const entry = { id: 'idee', dir: 'in', type: 'idea', label: 'Idée', note: null, state: null } as const;

describe('Port', () => {
  it('shows its Type d’artefact, then its note', async () => {
    const el = await render(Port, { ...entry, note: 'notée par toi' });
    expect(textOf(inside(el, '.label'))).toBe('Idée notée par toi');
    expect(textOf(inside(el, '.note'))).toBe('notée par toi');
  });

  it('as an Entrée has a hollow dot on its left edge, as a Sortie a filled one on its right, in its type’s colour', async () => {
    const input = await render(Port, entry);
    const output = await render(Port, { ...entry, dir: 'out' });
    const dot = (el: Element) => inside(el, '.dot');
    const host = (el: Element) => el.getBoundingClientRect();
    const box = (el: Element) => dot(el).getBoundingClientRect();
    expect(Math.abs(box(input).left + box(input).width / 2 - host(input).left)).toBeLessThan(2);
    expect(Math.abs(box(output).left + box(output).width / 2 - host(output).right)).toBeLessThan(2);
    const idee = getComputedStyle(document.documentElement).getPropertyValue('--cd-type-idee').trim();
    expect(idee).not.toBe('');
    expect(getComputedStyle(inside(input, '.port')).getPropertyValue('--type').trim()).toBe(idee);
    expect(getComputedStyle(dot(input)).borderTopColor).toBe(getComputedStyle(dot(output)).backgroundColor);
    expect(getComputedStyle(dot(input)).backgroundColor).not.toBe(getComputedStyle(dot(output)).backgroundColor);
  });

  it.each([
    ['mockups', 'maquettes'],
    ['technical-design', 'conception'],
    ['code-change', 'changement'],
    ['verdict', 'verdict'],
  ] as const)('takes the colour of %s from --cd-type-%s', async (type, slug) => {
    const el = await render(Port, { ...entry, type });
    expect(inside(el, '.port').getAttribute('style')).toBe(`--type: var(--cd-type-${slug})`);
  });

  it('unfed says « rien ne l’alimente » to screen readers only', async () => {
    const el = await render(Port, { ...entry, state: 'unfed' });
    const hidden = inside(el, '.label .visually-hidden');
    expect(textOf(hidden)).toBe(', rien ne l’alimente');
    expect(hidden.getBoundingClientRect().width).toBeLessThan(4);
    const fed = await render(Port, entry);
    expect(fed.shadowRoot?.textContent).not.toContain('rien ne l’alimente');
  });
});
