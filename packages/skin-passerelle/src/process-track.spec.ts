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
  { label: 'Maquettes', meta: 'pas dans la v2', state: 'off' },
  { label: 'Conception technique', meta: 'depuis 9:10', state: 'current' },
  { label: 'Découpage en Tickets', meta: null, state: 'todo' },
] as const;

const items = (el: Element) => [...(el.shadowRoot?.querySelectorAll('ol > li') ?? [])];

describe('ProcessTrack', () => {
  it('is an ordered list of its steps, in order', async () => {
    const el = await render(COMPOSANTS.ProcessTrack, { direction: 'vertical', steps });
    expect(items(el).map((li) => textOf(li.querySelector('b')))).toEqual(steps.map((step) => step.label));
    expect(textOf(items(el)[0]?.querySelector('.meta'))).toBe('3 nov.');
    expect(items(el)[4]?.querySelector('.meta')).toBeNull();
  });

  it('marks the current step, and it alone, aria-current="step"', async () => {
    const el = await render(COMPOSANTS.ProcessTrack, { direction: 'vertical', steps });
    expect(items(el).map((li) => li.getAttribute('aria-current'))).toEqual([null, null, null, 'step', null]);
  });

  it('shows « hors de sa version » on a step its Process version does not have', async () => {
    const el = await render(COMPOSANTS.ProcessTrack, { direction: 'vertical', steps });
    const off = inside(el, 'ol > li:nth-child(3) .state');
    expect(textOf(off)).toBe('hors de sa version');
    expect(off.classList).not.toContain('visually-hidden');
    expect(off.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it('says the state of every other step to screen readers', async () => {
    const el = await render(COMPOSANTS.ProcessTrack, {
      direction: 'vertical',
      steps: [...steps, { label: 'Merge', meta: null, state: 'halt' }, { label: 'Review', meta: null, state: 'stopped' }],
    });
    const states = items(el).map((li) => li.querySelector('.state'));
    expect(states.map(textOf)).toEqual(['faite', 'faite', 'hors de sa version', 'en cours', 'à venir', 'arrêtée', 'arrêtée à la Source']);
    expect(states.filter((state) => state?.classList.contains('visually-hidden'))).toHaveLength(6);
  });

  it('marks a step stopped at the Source with the stop icon, neutral, not as a halt', async () => {
    const el = await render(COMPOSANTS.ProcessTrack, {
      direction: 'vertical',
      steps: [
        { label: 'Checks', meta: '1 sur 4 échoué', state: 'halt' },
        { label: 'Review', meta: 'arrêtée à 15:20 : Ticket fermé sur GitHub', state: 'stopped' },
      ],
    });
    const [halt, stopped] = items(el);
    const iconOf = (li: Element | undefined) => (li?.querySelector('.mark cd-icon') as (Element & { data: { name: string } }) | null)?.data.name;
    expect(iconOf(stopped)).toBe('stop');
    expect(iconOf(halt)).toBe('x');
    const mark = (li: Element | undefined) => getComputedStyle(li?.querySelector('.mark') as Element);
    expect(mark(stopped).borderTopColor).not.toBe(mark(halt).borderTopColor);
    expect(mark(stopped).color).not.toBe(mark(halt).color);
    expect(textOf(stopped?.querySelector('.state'))).toBe('arrêtée à la Source');
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

  it.each([390, 1280])('compact at %s px lines up its steps, each label beside its mark, without meta', async (width) => {
    await page.viewport(width, 800);
    const el = await render(COMPOSANTS.ProcessTrack, { direction: 'compact', steps: steps.slice(0, 3) });
    const [first, second, third] = items(el).map((li) => li.getBoundingClientRect());
    expect(second?.top).toBe(first?.top);
    expect(third?.left).toBeGreaterThan(second?.left ?? Infinity);
    const mark = inside(el, 'ol > li:first-child .mark').getBoundingClientRect();
    const label = inside(el, 'ol > li:first-child b').getBoundingClientRect();
    expect(label.left).toBeGreaterThanOrEqual(mark.right);
    expect(inside(el, 'ol > li:first-child .meta').getBoundingClientRect().width).toBe(0);
  });

  it('vertical at 1280 px stacks its steps', async () => {
    await page.viewport(1280, 800);
    const el = await render(COMPOSANTS.ProcessTrack, { direction: 'vertical', steps });
    const [first, second] = items(el).map((li) => li.getBoundingClientRect());
    expect(second?.top).toBeGreaterThanOrEqual(first?.bottom ?? Infinity);
  });
});
