/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const [both, offline, compact] = COMPOSANTS.UsageCard.examples.map((example) => example.data);

const card = (el: Element) => inside(el, 'cd-card');
const all = (el: Element, selector: string) => [...(el.shadowRoot?.querySelectorAll(selector) ?? [])];

describe('UsageCard', () => {
  it('is a card titled and named as its data says', async () => {
    const el = await render(COMPOSANTS.UsageCard, both);
    expect((card(el) as unknown as { data: unknown }).data).toEqual({ title: 'Usage des Comptes IA', label: 'Usage des Comptes IA' });
  });

  it('gives each Compte IA its title, a meter per window, and an API key its month spend', async () => {
    const el = await render(COMPOSANTS.UsageCard, both);
    expect(all(el, 'h3').map(textOf)).toEqual(['Claude · abonnement', 'Codex · clé API']);
    const meters = all(el, 'cd-usage-meter') as (Element & { data: { label: string; projection: string | null } })[];
    expect(meters.map((meter) => meter.data.label)).toEqual(['Fenêtre de 5 h', 'Semaine']);
    expect(meters[1]?.data.projection).toBe('Réinitialisation lundi ; au rythme actuel, la semaine tient jusqu’à jeudi.');
    const spend = all(el, 'cd-key-value') as (Element & { data: unknown })[];
    expect(spend.map((kv) => kv.data)).toEqual([{ items: [{ label: t('usage.monthSpend'), value: '21,60 €', mono: false }] }]);
  });

  it('says a Compte IA’s note under its title, before its meters', async () => {
    const el = await render(COMPOSANTS.UsageCard, offline);
    const account = inside(el, '.account');
    expect([...account.children].map((child) => child.localName)).toEqual(['h3', 'p', 'cd-usage-meter']);
    expect(textOf(inside(el, '.note'))).toBe('Dernière mesure à 14:02, avant que le Runner se coupe.');
  });

  it('has no heading for a Compte IA without a title, and its note under its meters', async () => {
    const el = await render(COMPOSANTS.UsageCard, {
      ...compact,
      accounts: compact?.accounts.map((account) => ({ ...account, note: 'Dernière mesure à 14:02, avant la coupure du Runner.' })),
    });
    expect(all(el, 'h3')).toHaveLength(0);
    expect([...inside(el, '.account').children].map((child) => child.localName)).toEqual(['cd-usage-meter', 'cd-usage-meter', 'p']);
  });
});
