import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { actionsOf, centreOf, defineSkin, inside, pointer, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const { StepCard } = COMPOSANTS;
const agent = { id: 'prd', name: 'PRD', kindLabel: 'Agent', variant: 'agent', selected: false, gaps: 0, judges: false } as const;
const tools = { tools: '<cd-tool-chip data=\'{"kind":"role","label":"Conception"}\'></cd-tool-chip>' };

describe('StepCard', () => {
  it('is a focusable article named « Étape / <name> », with its kind', async () => {
    const el = await render(StepCard, agent, tools);
    const article = inside(el, 'article');
    expect(article.getAttribute('aria-label')).toBe('Étape / PRD');
    expect(article.tabIndex).toBe(0);
    expect(textOf(inside(el, '.kind'))).toBe('Agent');
  });

  it('shows « aucun Outil » without Outils, and its Outils otherwise', async () => {
    const bare = await render(StepCard, agent);
    expect(textOf(inside(bare, 'footer'))).toBe('aucun Outil');
    const equipped = await render(StepCard, agent, tools);
    expect(equipped.shadowRoot?.querySelector('.none')).toBeNull();
  });

  it('shows its Manques’ count, in caution', async () => {
    const one = await render(StepCard, { ...agent, gaps: 1 });
    expect(textOf(inside(one, '.gap-count'))).toBe('1 Manque');
    expect(inside(one, 'article').classList.contains('gaps')).toBe(true);
    const two = await render(StepCard, { ...agent, gaps: 2 });
    expect(textOf(inside(two, '.gap-count'))).toBe('2 Manques');
  });

  it('as a gate is the compact dashed card, the user icon before its kind, without Outils’ footer', async () => {
    const el = await render(StepCard, { ...agent, variant: 'gate', kindLabel: 'Pilote' });
    expect(el.shadowRoot?.querySelector('footer')).toBeNull();
    expect(el.shadowRoot?.textContent).not.toContain('aucun Outil');
    expect(inside(el, '.kind cd-icon')).toBeTruthy();
    expect(getComputedStyle(inside(el, 'article')).borderTopStyle).toBe('dashed');
    const width = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) * 16;
    expect(el.getBoundingClientRect().width).toBeCloseTo(width('--cd-gate-card'));
  });

  it('when it judges shows the Retour’s handle, alone in a gate’s footer', async () => {
    const el = await render(StepCard, { ...agent, variant: 'gate', kindLabel: 'Pilote', judges: true });
    const handle = inside(el, 'footer .handle');
    expect(handle.title).toBe('Tirer vers une Étape antérieure pour poser un Retour');
    expect(inside(el, 'footer').children).toHaveLength(1);
    const plain = await render(StepCard, agent);
    expect(plain.shadowRoot?.querySelector('.handle')).toBeNull();
  });

  it('emits select on a click and on Enter, startLoopBack alone on a press on its handle', async () => {
    const el = await render(StepCard, { ...agent, judges: true }, tools);
    const article = inside(el, 'article');
    const clicked = await actionsOf(() => article.click());
    const entered = await actionsOf(() => article.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })));
    const handle = inside(el, '.handle');
    const pressed = await actionsOf(() => pointer('pointerdown', handle, centreOf(handle)));
    expect([...clicked, ...entered, ...pressed].map((detail) => detail.action)).toEqual(['select', 'select', 'startLoopBack']);
  });

  it('marks its selection with the accent', async () => {
    const el = await render(StepCard, { ...agent, selected: true });
    expect(inside(el, 'article').classList.contains('selected')).toBe(true);
  });
});
