/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { page } from 'vitest/browser';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());
afterAll(() => page.viewport(414, 896));

const data = {
  weeks: ['S45', 'S46', 'S47', 'S48', 'S49', 'S50'],
  today: 1,
  rows: [
    { label: 'Agenda', start: 0, span: 1, tone: 'go', meta: null, detail: 'terminé le 6 nov.' },
    { label: 'Planning', start: 1, span: 2, tone: 'accent', meta: '3/5', detail: 'fin estimée 20 nov.' },
    { label: 'Rappels', start: 2, span: 3, tone: 'caution', meta: '0/3', detail: 'bloqué par #51 · fin estimée 4 déc.' },
  ],
} as const;

const box = (el: Element) => el.getBoundingClientRect();
const week = (el: Element, index: number) => inside(el, `.weeks > span:nth-child(${index + 1})`);
const bar = (el: Element, row: number) => inside(el, `.rows > li:nth-child(${row + 1}) .bar`);

/** The text of `root` a screen reader reaches: none under `aria-hidden`, `display: none` or `visibility: hidden`. */
const spoken = (root: Element): string => {
  const style = getComputedStyle(root);
  if (root.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return '';
  return [...root.childNodes]
    .map((node) => (node instanceof Element ? spoken(node) : node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '') : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

describe.each([
  [390, 844],
  [1280, 800],
])('Timeline at %s px', (width, height) => {
  beforeAll(() => page.viewport(width, height));

  it.each(data.rows.map((row, index) => [row.label, index, row] as const))(
    'places « %s » from its start week over its span',
    async (_label, index, row) => {
      const el = await render(COMPOSANTS.Timeline, data);
      const from = box(week(el, row.start));
      const to = box(week(el, row.start + row.span - 1));
      const drawn = box(bar(el, index));
      expect(drawn.left).toBeGreaterThanOrEqual(from.left - 1);
      expect(drawn.left).toBeLessThan(from.left + from.width / 2);
      expect(drawn.right).toBeLessThanOrEqual(to.right + 1);
      expect(drawn.right).toBeGreaterThan(to.right - to.width / 2);
    },
  );

  it('marks the current week, over every row', async () => {
    const el = await render(COMPOSANTS.Timeline, data);
    expect(week(el, 1).getAttribute('aria-current')).toBe('date');
    expect(week(el, 0).hasAttribute('aria-current')).toBe(false);
    const current = box(week(el, 1));
    const markers = [...(el.shadowRoot?.querySelectorAll('.today') ?? [])];
    expect(markers).toHaveLength(data.rows.length);
    for (const marker of markers) {
      expect(box(marker).left).toBeCloseTo(current.left, 0);
      expect(box(marker).width).toBeCloseTo(current.width, 0);
    }
  });

  it('says each row with its period, its detail and its progress', async () => {
    const el = await render(COMPOSANTS.Timeline, data);
    const rows = [...(el.shadowRoot?.querySelectorAll('.rows > li') ?? [])];
    expect(rows.map((row) => row.textContent?.includes(row.querySelector('b')?.textContent ?? '?'))).toEqual([true, true, true]);
    expect(textOf(rows[0]?.querySelector('.period'))).toBe('S45');
    expect(textOf(rows[2]?.querySelector('.period'))).toBe('de S47 à S49');
    expect(textOf(rows[2]?.querySelector('small'))).toBe('bloqué par #51 · fin estimée 4 déc.');
    const visibleMeta = [...(rows[1]?.querySelectorAll('.meta') ?? [])].filter((meta) => box(meta).width > 0 && getComputedStyle(meta).clipPath === 'none');
    expect(visibleMeta.map(textOf)).toEqual(['3/5']);
  });

  it('says each row’s progress to screen readers, once', async () => {
    const el = await render(COMPOSANTS.Timeline, data);
    const rows = [...(el.shadowRoot?.querySelectorAll('.rows > li') ?? [])];
    expect(rows.map((row) => spoken(row))).toEqual([
      'Agenda terminé le 6 nov. S45',
      'Planning fin estimée 20 nov. 3/5 de S46 à S47',
      'Rappels bloqué par #51 · fin estimée 4 déc. 0/3 de S47 à S49',
    ]);
  });
});

describe('Timeline at 390 px', () => {
  beforeAll(() => page.viewport(390, 844));

  it('puts each row on its own line, its bar under its label', async () => {
    const el = await render(COMPOSANTS.Timeline, data);
    const label = box(inside(el, '.rows > li:nth-child(2) .label'));
    const track = box(inside(el, '.rows > li:nth-child(2) .track'));
    expect(track.top).toBeGreaterThanOrEqual(label.bottom);
  });
});

describe('Timeline at 1280 px', () => {
  beforeAll(() => page.viewport(1280, 800));

  it('puts each row’s label beside its bar, its progress in the bar', async () => {
    const el = await render(COMPOSANTS.Timeline, data);
    const label = box(inside(el, '.rows > li:nth-child(2) .label'));
    const track = box(inside(el, '.rows > li:nth-child(2) .track'));
    expect(track.left).toBeGreaterThanOrEqual(label.right);
    expect(textOf(bar(el, 1))).toBe('3/5');
  });
});
