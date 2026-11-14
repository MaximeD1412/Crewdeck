/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const PHASE = { name: 'Développement', forEach: 'chaque Ticket prêt', count: '5 Étapes · 2 Retours', gaps: 2, open: true } as const;
const ROW = `<cd-step-row data='${JSON.stringify({
  name: 'Code',
  kindLabel: 'Agent',
  icon: 'spark',
  tools: 'Rôle Code · red-green',
  flow: 'Ticket → Changement de code',
  loopBack: null,
  gap: null,
})}'></cd-step-row>`;

const details = (el: Element) => inside<HTMLDetailsElement>(el, 'details');

describe('PhaseGroup', () => {
  it('is a details named « Phase / {name} », open when open is true', async () => {
    const el = await render(COMPOSANTS.PhaseGroup, PHASE, { default: ROW });
    expect(details(el).open).toBe(true);
    expect(details(el).getAttribute('aria-label')).toBe(t('phaseGroup.label', { name: 'Développement' }));
    expect(textOf(inside(el, 'summary .name'))).toBe('Développement');
  });

  it('renders folded when open is false', async () => {
    const el = await render(COMPOSANTS.PhaseGroup, { ...PHASE, open: false }, { default: ROW });
    expect(details(el).open).toBe(false);
  });

  it('shows « pour {forEach} · {count} » in its summary', async () => {
    const el = await render(COMPOSANTS.PhaseGroup, PHASE);
    expect(textOf(inside(el, 'summary .meta'))).toBe('pour chaque Ticket prêt · 5 Étapes · 2 Retours');
  });

  it('shows its count alone when it repeats over nothing', async () => {
    const el = await render(COMPOSANTS.PhaseGroup, { ...PHASE, forEach: null });
    expect(textOf(inside(el, 'summary .meta'))).toBe('5 Étapes · 2 Retours');
  });

  it.each([
    [2, '2 Manques'],
    [1, '1 Manque'],
  ])('shows its %s Manque(s) in a caution badge', async (gaps, label) => {
    const el = await render(COMPOSANTS.PhaseGroup, { ...PHASE, gaps });
    const badge = inside<HTMLElement & { data: unknown }>(el, 'summary cd-status-badge');
    expect(badge.data).toEqual({ tone: 'caution', label });
  });

  it('has no badge without a Manque', async () => {
    const el = await render(COMPOSANTS.PhaseGroup, { ...PHASE, gaps: 0 });
    expect(el.shadowRoot?.querySelector('cd-status-badge')).toBeNull();
  });

  it('puts its Étapes in its default Emplacement', async () => {
    const el = await render(COMPOSANTS.PhaseGroup, PHASE, { default: ROW });
    const slot = inside<HTMLSlotElement>(el, 'details > .body slot:not([name])');
    expect(slot.assignedElements().map((node) => node.localName)).toEqual(['cd-step-row']);
  });

  it('folds and unfolds freely, its new data keeping the Pilote’s choice', async () => {
    const el = await render(COMPOSANTS.PhaseGroup, PHASE, { default: ROW });
    inside(el, 'summary').click();
    expect(details(el).open).toBe(false);
    el.data = { ...PHASE, count: '6 Étapes · 2 Retours' };
    await settle(el);
    expect(details(el).open).toBe(false);
    inside(el, 'summary').click();
    expect(details(el).open).toBe(true);
  });
});
