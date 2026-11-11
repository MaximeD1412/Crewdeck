/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

describe('CheckRow', () => {
  it.each([
    ['passed', 'réussi', 'go'],
    ['failed', 'échoué', 'halt'],
    ['running', 'en cours', 'accent'],
  ] as const)('%s says « %s » and takes the %s tone', async (state, label, tone) => {
    const el = await render(COMPOSANTS.CheckRow, { name: 'Tests', state, detail: '186 tests', href: null });
    expect(textOf(inside(el, '.name'))).toBe('Tests');
    expect(textOf(inside(el, '.state'))).toBe(label);
    expect(textOf(inside(el, '.detail'))).toBe('186 tests');
    expect(inside(el, '.check').classList).toContain(tone);
  });

  it('turns while it runs, its mark otherwise', async () => {
    const running = await render(COMPOSANTS.CheckRow, { name: 'Build', state: 'running', detail: null, href: null });
    expect(running.shadowRoot?.querySelector('.mark .spinner')).not.toBeNull();
    const failed = await render(COMPOSANTS.CheckRow, { name: 'Lint', state: 'failed', detail: null, href: null });
    expect((failed.shadowRoot?.querySelector('.mark cd-icon') as Element & { data: unknown }).data).toEqual({ name: 'x', size: 'sm' });
  });

  it('links its name to its log', async () => {
    const el = await render(COMPOSANTS.CheckRow, { name: 'Lint', state: 'failed', detail: '3 erreurs', href: '/logs/lint' });
    const link = inside<HTMLAnchorElement>(el, 'a.name');
    expect(link.getAttribute('href')).toBe('/logs/lint');
    expect(textOf(link)).toBe('Lint');
  });

  it('has no detail without one', async () => {
    const el = await render(COMPOSANTS.CheckRow, { name: 'Build', state: 'running', detail: null, href: null });
    expect(el.shadowRoot?.querySelector('.detail')).toBeNull();
  });
});
