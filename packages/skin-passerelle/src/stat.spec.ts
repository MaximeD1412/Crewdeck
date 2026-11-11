/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

describe('Stat', () => {
  it('shows its label, its value as given with its unit, and what it measures', async () => {
    const el = await render(COMPOSANTS.Stat, { label: 'Délai Idée → merge', value: '3,4', unit: 'j', detail: 'médiane · 30 jours' });
    expect(textOf(inside(el, '.label'))).toBe('Délai Idée → merge');
    expect(textOf(inside(el, '.value'))).toBe('3,4 j');
    expect(textOf(inside(el, '.detail'))).toBe('médiane · 30 jours');
  });

  it('draws its value in the stat type, its figures tabular', async () => {
    const el = await render(COMPOSANTS.Stat, { label: 'Réussite de la Boucle', value: '86', unit: '%', detail: null });
    const style = getComputedStyle(inside(el, '.value'));
    expect(style.fontVariantNumeric).toBe('tabular-nums');
    expect(style.fontSize).toBe(getComputedStyle(document.documentElement).getPropertyValue('--cd-font-stat-size').trim());
    expect(el.shadowRoot?.querySelector('.detail')).toBeNull();
  });

  it('has no unit without one', async () => {
    const el = await render(COMPOSANTS.Stat, { label: 'Tickets mergés', value: '41', unit: null, detail: null });
    expect(textOf(inside(el, '.value'))).toBe('41');
    expect(el.shadowRoot?.querySelector('.value small')).toBeNull();
  });
});
