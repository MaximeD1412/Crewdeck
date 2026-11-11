/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

const { AgentRow } = COMPOSANTS;

const ID = '0193a4f2-7c1e-7a10-8d2c-4d5e6f708194';
const reviewing = {
  sessionId: ID,
  projet: 'Personal OS',
  ticket: '#53 Export du planning',
  step: 'en review',
  engine: 'Codex',
  since: 'depuis 6 min',
  tone: 'go',
} as const;

const colourOf = (value: string) => {
  const probe = document.createElement('div');
  probe.style.background = value;
  document.body.append(probe);
  return getComputedStyle(probe).backgroundColor;
};

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

describe('AgentRow', () => {
  beforeEach(() => page.viewport(1280, 800));

  it('shows its Projet in bold, its Ticket, its Étape, its Moteur and since when', async () => {
    const el = await render(AgentRow, reviewing);
    expect(textOf(inside(el, '.title'))).toBe('Personal OS · #53 Export du planning');
    expect(textOf(inside(el, '.title b'))).toBe('Personal OS');
    expect(textOf(inside(el, '.step'))).toBe('en review');
    expect(textOf(inside(el, '.meta'))).toBe('en review Codex · depuis 6 min');
  });

  it.each([
    ['go', 'accent-soft', true],
    ['accent', 'accent-soft', false],
    ['caution', 'caution-soft', false],
    ['halt', 'halt-soft', false],
  ] as const)('in %s, tints its Étape in %s; its dot is haloed only while it runs (go)', async (tone, soft, halo) => {
    const el = await render(AgentRow, { ...reviewing, tone });
    expect(getComputedStyle(inside(el, '.step')).backgroundColor).toBe(colourOf(`var(--cd-${soft})`));
    const dot = inside(el, '.dot');
    expect(getComputedStyle(dot).backgroundColor).toBe(colourOf(`var(--cd-${tone})`));
    expect(getComputedStyle(dot).boxShadow === 'none').toBe(!halo);
  });

  it('is one control reached by Tab, opening its Session on Enter and on a click', async () => {
    const el = await render(AgentRow, reviewing);
    const open = [{ composant: 'AgentRow', action: 'open', payload: { sessionId: ID } }];
    await userEvent.tab();
    expect(el.shadowRoot?.activeElement).toBe(inside(el, 'button'));
    expect(await actionsOf(() => userEvent.keyboard('{Enter}'))).toEqual(open);
    expect(await actionsOf(() => userEvent.click(inside(el, '.meta')))).toEqual(open);
    expect(el.shadowRoot?.querySelectorAll('button, a')).toHaveLength(1);
    expect(inside(el, 'button').querySelector('button, a, slot')).toBeNull();
  });

  it.each([390, 1280])('is 56 to 72 px tall at %i px', async (width) => {
    await page.viewport(width, 800);
    const el = await render(AgentRow, reviewing);
    const { height } = inside(el, '[part=row]').getBoundingClientRect();
    expect(height).toBeGreaterThanOrEqual(56);
    expect(height).toBeLessThanOrEqual(72);
  });
});
