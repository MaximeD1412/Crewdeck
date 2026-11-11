/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const meter = (value: number, tone: 'accent' | 'caution' | 'halt' | null = null) =>
  render(COMPOSANTS.UsageMeter, { label: 'Semaine', value, detail: 'lundi', projection: null, tone });

describe('UsageMeter', () => {
  it.each([
    [0, 'accent'],
    [79, 'accent'],
    [80, 'caution'],
    [99, 'caution'],
    [100, 'halt'],
  ] as const)('at %s percent without a tone is %s', async (value, tone) => {
    const el = await meter(value);
    expect(inside(el, '.fill').classList).toContain(tone);
  });

  it('keeps the tone the view gives', async () => {
    const el = await meter(30, 'halt');
    expect(inside(el, '.fill').classList).toContain('halt');
  });

  it('is a meter named by its label, with its value', async () => {
    const el = await meter(62);
    const bar = inside(el, '[role=meter]');
    expect(bar.getAttribute('aria-label')).toBe('Semaine');
    expect(bar.getAttribute('aria-valuenow')).toBe('62');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')?.replace(/\s+/g, ' ')).toBe('62 % · lundi');
  });

  it('fills its bar up to its value', async () => {
    const el = await meter(62);
    const track = inside(el, '[role=meter]').getBoundingClientRect().width;
    expect(inside(el, '.fill').getBoundingClientRect().width).toBeCloseTo(track * 0.62, 0);
  });

  it('shows its value with its detail, and its projection under the bar', async () => {
    const el = await render(COMPOSANTS.UsageMeter, {
      label: 'Semaine',
      value: 62,
      detail: 'lundi',
      projection: 'Au rythme actuel, la semaine tient jusqu’à jeudi.',
      tone: null,
    });
    expect(textOf(inside(el, '.value'))).toBe('62 % · lundi');
    expect(textOf(inside(el, '.projection'))).toBe('Au rythme actuel, la semaine tient jusqu’à jeudi.');
  });

  it('has no projection line without one', async () => {
    const el = await render(COMPOSANTS.UsageMeter, { label: 'Fenêtre de 5 h', value: 30, detail: null, projection: null, tone: null });
    expect(textOf(inside(el, '.value'))).toBe('30 %');
    expect(el.shadowRoot?.querySelector('.projection')).toBeNull();
  });
});
