/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const STEPPER = { label: 'Au plus', value: 3, unit: 'fois', min: 1, max: 10 } as const;

const decrease = (el: Element) => inside<HTMLButtonElement>(el, 'button.decrease');
const increase = (el: Element) => inside<HTMLButtonElement>(el, 'button.increase');
const press = (el: Element, key: string) =>
  inside(el, '[role=group]').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));

describe('Stepper', () => {
  it('is a group named by its label, « Moins » and « Plus » around a polite output of its value and unit', async () => {
    const el = await render(COMPOSANTS.Stepper, STEPPER);
    const group = inside(el, '[role=group]');
    expect(group.getAttribute('aria-labelledby')).toBe('label');
    expect(textOf(inside(el, '#label'))).toBe('Au plus');
    expect(decrease(el).getAttribute('aria-label')).toBe(t('stepper.decrease'));
    expect(increase(el).getAttribute('aria-label')).toBe(t('stepper.increase'));
    const output = inside(el, 'output');
    expect(output.getAttribute('aria-live')).toBe('polite');
    expect(textOf(output)).toBe('3 fois');
    expect([...group.querySelectorAll('button, output')].map((node) => node.localName)).toEqual(['button', 'output', 'button']);
  });

  it('shows its value alone without a unit', async () => {
    const el = await render(COMPOSANTS.Stepper, { ...STEPPER, unit: null });
    expect(textOf(inside(el, 'output'))).toBe('3');
  });

  it('emits change with one less or one more on « Moins » and « Plus »', async () => {
    const el = await render(COMPOSANTS.Stepper, STEPPER);
    expect(await actionsOf(() => decrease(el).click())).toEqual([{ composant: 'Stepper', action: 'change', payload: { value: 2 } }]);
    expect(await actionsOf(() => increase(el).click())).toEqual([{ composant: 'Stepper', action: 'change', payload: { value: 4 } }]);
  });

  it('emits change with value + 1 on ArrowUp and value - 1 on ArrowDown', async () => {
    const el = await render(COMPOSANTS.Stepper, STEPPER);
    expect(await actionsOf(() => press(el, 'ArrowUp'))).toEqual([{ composant: 'Stepper', action: 'change', payload: { value: 4 } }]);
    expect(await actionsOf(() => press(el, 'ArrowDown'))).toEqual([{ composant: 'Stepper', action: 'change', payload: { value: 2 } }]);
  });

  it('disables « Plus » at its max and emits nothing above it', async () => {
    const el = await render(COMPOSANTS.Stepper, { ...STEPPER, value: 10 });
    expect(increase(el).disabled).toBe(true);
    expect(decrease(el).disabled).toBe(false);
    expect(await actionsOf(() => press(el, 'ArrowUp'))).toEqual([]);
    expect(await actionsOf(() => increase(el).click())).toEqual([]);
  });

  it('disables « Moins » at its min and emits nothing below it', async () => {
    const el = await render(COMPOSANTS.Stepper, { ...STEPPER, value: 1 });
    expect(decrease(el).disabled).toBe(true);
    expect(increase(el).disabled).toBe(false);
    expect(await actionsOf(() => press(el, 'ArrowDown'))).toEqual([]);
    expect(await actionsOf(() => decrease(el).click())).toEqual([]);
  });

  it('leaves the other keys alone', async () => {
    const el = await render(COMPOSANTS.Stepper, STEPPER);
    expect(await actionsOf(() => press(el, 'ArrowLeft'))).toEqual([]);
  });
});
