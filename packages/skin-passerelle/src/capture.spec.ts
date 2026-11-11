/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const [phone, desktop] = COMPOSANTS.Capture.examples;
const rem = (value: number) => value * parseFloat(getComputedStyle(document.documentElement).fontSize);

describe('Capture', () => {
  it('is its image, described, with its caption', async () => {
    const el = await render(COMPOSANTS.Capture, phone?.data);
    const img = inside<HTMLImageElement>(el, 'figure img');
    expect(img.getAttribute('src')).toBe(phone?.data.src);
    expect(img.alt).toBe('La page Planning livrée, au téléphone');
    expect(textOf(inside(el, 'figcaption'))).toBe('Livré · 390');
  });

  it('asks to enlarge it on a press, with its address', async () => {
    const el = await render(COMPOSANTS.Capture, phone?.data);
    const button = inside<HTMLButtonElement>(el, 'button');
    expect(button.getAttribute('aria-label')).toBe('Agrandir : Livré · 390');
    const details = await actionsOf(() => button.click());
    expect(details).toEqual([{ composant: 'Capture', action: 'open', payload: { src: phone?.data.src } }]);
  });

  it.each([
    ['sm', phone, 12],
    ['lg', desktop, 22],
  ] as const)('%s is as wide as its token', async (_size, example, width) => {
    const el = await render(COMPOSANTS.Capture, example?.data);
    expect(inside(el, 'figure').getBoundingClientRect().width).toBeCloseTo(rem(width), 0);
  });
});
