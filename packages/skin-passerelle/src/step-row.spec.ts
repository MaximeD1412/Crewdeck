/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const STEP = {
  name: 'Review',
  kindLabel: 'Agent',
  icon: 'spark',
  tools: 'Rôle Review · review',
  flow: 'Changement de code → Verdict',
  loopBack: 'vers « Code », 3 fois au plus',
  gap: null,
} as const;

const iconOf = (el: Element) => (inside(el, '.icon cd-icon') as HTMLElement & { data: { name: string } }).data.name;

describe('StepRow', () => {
  it('shows its icon, « {name} · {kindLabel} », its tools and its flow in mono', async () => {
    const el = await render(COMPOSANTS.StepRow, STEP);
    expect(iconOf(el)).toBe('spark');
    expect(textOf(inside(el, '.title'))).toBe('Review · Agent');
    expect(textOf(inside(el, '.tools'))).toBe('Rôle Review · review');
    const flow = inside(el, '.flow');
    expect(textOf(flow)).toBe('Changement de code → Verdict');
    expect(getComputedStyle(flow).fontFamily).toMatch(/mono/i);
  });

  it('leaves its kind out when it is its name', async () => {
    const el = await render(COMPOSANTS.StepRow, { ...STEP, name: 'Revue croisée', kindLabel: 'Revue croisée' });
    expect(textOf(inside(el, '.title'))).toBe('Revue croisée');
  });

  it('shows « Retour {loopBack} » with the undo icon', async () => {
    const el = await render(COMPOSANTS.StepRow, STEP);
    const loop = inside(el, '.loop-back');
    expect(textOf(loop)).toBe(t('stepRow.loopBack', { loopBack: 'vers « Code », 3 fois au plus' }));
    expect((loop.querySelector('cd-icon') as HTMLElement & { data: { name: string } }).data.name).toBe('undo');
  });

  it('has neither tools, Retour nor gap lines without them', async () => {
    const el = await render(COMPOSANTS.StepRow, { ...STEP, tools: null, loopBack: null });
    expect(el.shadowRoot?.querySelector('.tools')).toBeNull();
    expect(el.shadowRoot?.querySelector('.loop-back')).toBeNull();
    expect(el.shadowRoot?.querySelector('.gap')).toBeNull();
  });

  it('shows the alert icon and its gap in caution when it has one', async () => {
    const el = await render(COMPOSANTS.StepRow, { ...STEP, gap: 'Aucune Commande attachée' });
    expect(iconOf(el)).toBe('alert');
    const gap = inside(el, '.gap');
    expect(textOf(gap)).toBe('Aucune Commande attachée');
    const caution = getComputedStyle(document.documentElement).getPropertyValue('--cd-caution').trim();
    const probe = document.createElement('span');
    probe.style.color = caution;
    document.body.append(probe);
    expect(getComputedStyle(gap).color).toBe(getComputedStyle(probe).color);
  });
});
