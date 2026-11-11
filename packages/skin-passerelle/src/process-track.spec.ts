/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { page } from 'vitest/browser';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());
afterAll(() => page.viewport(414, 896));

const steps = [
  { label: 'Idée retenue', meta: '3 nov.', state: 'done' },
  { label: 'PRD', meta: 'approuvé le 5 nov.', state: 'done' },
  { label: 'Maquettes', meta: null, state: 'off' },
  { label: 'Conception technique', meta: 'depuis 9:10', state: 'current' },
  { label: 'Découpage en Tickets', meta: null, state: 'todo' },
] as const;

const items = (el: Element) => [...(el.shadowRoot?.querySelectorAll('ol > li') ?? [])];

describe('ProcessTrack', () => {
  it('is an ordered list of its steps, in order', async () => {
    const el = await render(COMPOSANTS.ProcessTrack, { direction: 'vertical', steps });
    expect(items(el).map((li) => textOf(li.querySelector('b')))).toEqual(steps.map((step) => step.label));
    expect(textOf(items(el)[0]?.querySelector('.meta'))).toBe('3 nov.');
    expect(items(el)[2]?.querySelector('.meta')).toBeNull();
  });

  it('marks the current step, and it alone, aria-current="step"', async () => {
    const el = await render(COMPOSANTS.ProcessTrack, { direction: 'vertical', steps });
    expect(items(el).map((li) => li.getAttribute('aria-current'))).toEqual([null, null, null, 'step', null]);
  });

  it('shows « désactivée » on a step turned off', async () => {
    const el = await render(COMPOSANTS.ProcessTrack, { direction: 'vertical', steps });
    const off = inside(el, 'ol > li:nth-child(3) .state');
    expect(textOf(off)).toBe('désactivée');
    expect(off.classList).not.toContain('visually-hidden');
    expect(off.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it('says the state of every other step to screen readers', async () => {
    const el = await render(COMPOSANTS.ProcessTrack, {
      direction: 'vertical',
      steps: [...steps, { label: 'Merge', meta: null, state: 'halt' }],
    });
    const states = items(el).map((li) => li.querySelector('.state'));
    expect(states.map(textOf)).toEqual(['faite', 'faite', 'désactivée', 'en cours', 'à venir', 'arrêtée']);
    expect(states.filter((state) => state?.classList.contains('visually-hidden'))).toHaveLength(5);
  });

  describe.each([
    [390, 844, 'stacks', false],
    [1280, 800, 'lines up', true],
  ] as const)('horizontal at %s px', (width, height, how, sideBySide) => {
    beforeAll(() => page.viewport(width, height));

    it(`${how} its steps`, async () => {
      const el = await render(COMPOSANTS.ProcessTrack, { direction: 'horizontal', steps });
      const [first, second] = items(el).map((li) => li.getBoundingClientRect());
      expect(second?.top === first?.top).toBe(sideBySide);
      expect((second?.left ?? 0) > (first?.left ?? 0)).toBe(sideBySide);
    });
  });

  it('vertical at 1280 px stacks its steps', async () => {
    await page.viewport(1280, 800);
    const el = await render(COMPOSANTS.ProcessTrack, { direction: 'vertical', steps });
    const [first, second] = items(el).map((li) => li.getBoundingClientRect());
    expect(second?.top).toBeGreaterThanOrEqual(first?.bottom ?? Infinity);
  });
});
