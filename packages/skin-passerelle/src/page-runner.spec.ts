/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, EXAMPLE_ENGINES, formatHour, t, type ComposantData, type PageRunner } from '@crewdeck/sdk';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof PageRunner>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const RUNNER = {
  machine: 'atelier-pc',
  os: 'linux',
  arch: 'amd64',
  wsl: true,
  runnerVersion: '0.4.2',
  state: 'online',
  lastSeenAt: '2026-11-11T14:12:00.000Z',
} as const;
const [CLAUDE] = EXAMPLE_ENGINES;
const ONLINE: Data = {
  engines: [
    CLAUDE as Data['engines'][number],
    {
      engine: 'codex',
      installed: true,
      knownVersion: true,
      kind: 'api-key',
      state: 'connected',
      models: [
        { id: 'gpt-5.5', label: 'GPT-5.5', usable: true },
        { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', usable: false, reason: 'quota-reached' },
      ],
      command: 'crewdeck-runner login codex',
    },
  ],
  command: 'crewdeck-runner login claude',
  runner: RUNNER,
  mcpServers: [
    { name: 'figma', transport: 'http', state: 'ready', toolCount: 4 },
    { name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 12 },
  ],
};

const page = (data: Data, slots?: Record<string, string>) => render(COMPOSANTS.PageRunner, data, slots);
const child = (el: Element, selector: string) => inside<WithData>(el, selector);
const all = (el: Element, selector: string) => [...(el.shadowRoot?.querySelectorAll<WithData>(selector) ?? [])];
const rows = (host: Element) =>
  [...host.querySelectorAll<WithData>('cd-list-row')].map((row) => ({
    title: row.data['title'],
    meta: row.data['meta'],
    badge: (row.querySelector('cd-status-badge') as WithData | null)?.data,
  }));
const mainCards = (el: Element) => all(el, '.main > *').map((node) => (node.tagName === 'SLOT' ? 'usage' : node.className));

describe('PageRunner', () => {
  it('lists every model of every Moteur, usable or why not, under « Moteurs et modèles »', async () => {
    const el = await page(ONLINE);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Runner et Comptes IA' });
    const engines = child(el, 'cd-card.engines');
    expect(engines.data).toEqual({ title: 'Moteurs et modèles', label: 'Moteurs et modèles', flush: true });
    expect(rows(engines)).toEqual([
      { title: 'claude-opus-5-5', meta: 'Claude Code · Compte IA Claude', badge: { tone: 'go', label: 'disponible' } },
      { title: 'claude-sonnet-5-5', meta: 'Claude Code · Compte IA Claude', badge: { tone: 'go', label: 'disponible' } },
      { title: 'claude-fable-5-1', meta: 'Claude Code · indisponible avec cet abonnement', badge: { tone: 'halt', label: 'indisponible' } },
      { title: 'gpt-5.5', meta: 'Codex · Compte IA Codex', badge: { tone: 'go', label: 'disponible' } },
      { title: 'gpt-5.5-pro', meta: 'Codex · Compte IA Codex', badge: { tone: 'caution', label: 'quota atteint' } },
    ]);
  });

  it('gives a Moteur without models one row with its Compte IA’s state', async () => {
    const el = await page(COMPOSANTS.PageRunner.examples[0]?.data as Data);
    expect(rows(child(el, 'cd-card.engines')).at(-1)).toEqual({
      title: 'Codex',
      meta: 'le Runner les liste une fois le Compte IA connecté',
      badge: { tone: 'caution', label: 'connexion requise' },
    });
  });

  it('says « version non vérifiée » of a Moteur whose version the adapter does not know, with its models', async () => {
    const [claude, codex] = ONLINE.engines as [Data['engines'][number], Data['engines'][number]];
    const el = await page({ ...ONLINE, engines: [{ ...claude, knownVersion: false }, codex] });
    expect(rows(child(el, 'cd-card.engines')).slice(0, 2)).toEqual([
      { title: 'Claude Code', meta: t('runner.unknownVersionMeta'), badge: { tone: 'caution', label: 'version non vérifiée' } },
      { title: 'claude-opus-5-5', meta: 'Claude Code · Compte IA Claude', badge: { tone: 'go', label: 'disponible' } },
    ]);
  });

  it('says « version non vérifiée » of a Moteur without models beside its Compte IA’s state', async () => {
    const [, codex] = COMPOSANTS.PageRunner.examples[0]?.data.engines as Data['engines'];
    const el = await page({ ...ONLINE, engines: [{ ...(codex as Data['engines'][number]), knownVersion: false }] });
    const [row] = [...child(el, 'cd-card.engines').querySelectorAll('cd-list-row')];
    expect([...(row?.querySelectorAll<WithData>('cd-status-badge') ?? [])].map((badge) => badge.data)).toEqual([
      { tone: 'caution', label: 'connexion requise' },
      { tone: 'caution', label: 'version non vérifiée' },
    ]);
  });

  it('shows how to connect a Compte IA, on the machine, never here', async () => {
    const el = await page(ONLINE);
    const connect = child(el, 'cd-card.connect');
    expect(connect.data).toEqual({ title: 'Connecter un Compte IA', label: 'Connecter un Compte IA' });
    expect(textOf(connect.querySelector('p') as HTMLElement)).toBe('Sur ta machine, jamais ici :');
    expect((connect.querySelector('cd-code-block') as WithData).data).toEqual({ code: 'crewdeck-runner login claude' });
    expect(el.shadowRoot?.querySelector('input, cd-text-field')).toBeNull();
  });

  it('shows the Runner online, its machine, system and version, and the encryption line', async () => {
    const el = await page(ONLINE);
    const runner = child(el, 'cd-card.runner');
    expect(runner.data).toEqual({ title: 'Runner', label: 'Runner' });
    expect((runner.querySelector('cd-status-badge[slot=actions]') as WithData).data).toEqual({ tone: 'go', label: 'en ligne' });
    expect((runner.querySelector('cd-key-value') as WithData).data['items']).toEqual([
      { label: 'Machine', value: 'atelier-pc', mono: false },
      { label: 'Système', value: 'Windows (WSL) · amd64', mono: false },
      { label: 'Version', value: '0.4.2', mono: false },
    ]);
    expect(textOf(runner.querySelector('.crypto') as HTMLElement)).toBe(t('runner.encrypted'));
  });

  it('says since when the Runner is offline', async () => {
    const el = await page({ ...ONLINE, runner: { ...RUNNER, state: 'offline' } });
    expect((child(el, 'cd-card.runner').querySelector('cd-status-badge[slot=actions]') as WithData).data).toEqual({
      tone: 'halt',
      label: `hors ligne depuis ${formatHour(RUNNER.lastSeenAt)}`,
    });
  });

  it('lists the Serveurs MCP declared on the Runner, their transport and tool count, and whether their test passed', async () => {
    const el = await page({
      ...ONLINE,
      mcpServers: [
        { name: 'figma', transport: 'http', state: 'ready', toolCount: 4 },
        { name: 'notion', transport: 'http', state: 'failed', toolCount: null },
        { name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 1 },
      ],
    });
    const mcp = child(el, 'cd-card.mcp');
    expect(mcp.data).toEqual({ title: 'Serveurs MCP', count: 3, label: 'Serveurs MCP', flush: true });
    expect(rows(mcp)).toEqual([
      { title: 'figma', meta: 'HTTP · 4 outils', badge: { tone: 'go', label: 'déclaré' } },
      { title: 'notion', meta: 'HTTP', badge: { tone: 'halt', label: 'en échec' } },
      { title: 'stitch', meta: 'stdio · 1 outil', badge: { tone: 'go', label: 'déclaré' } },
    ]);
    expect([...mcp.querySelectorAll<WithData>('cd-list-row')].map((row) => row.data['icon'])).toEqual(['layers', 'layers', 'layers']);
  });

  it('says when no Serveur MCP is declared', async () => {
    const el = await page({ ...ONLINE, mcpServers: [] });
    const mcp = child(el, 'cd-card.mcp');
    expect(mcp.data).toEqual({ title: 'Serveurs MCP', count: 0, label: 'Serveurs MCP' });
    expect(rows(mcp)).toEqual([]);
    expect(textOf(mcp.querySelector('p') as HTMLElement)).toBe('Aucun Serveur MCP déclaré.');
  });

  it('shows how to declare a Serveur MCP, on the machine, its secrets kept there', async () => {
    const el = await page(ONLINE);
    const declare = child(el, 'cd-card.mcp-declare');
    expect(declare.data).toEqual({ title: 'Déclarer un Serveur MCP', label: 'Déclarer un Serveur MCP' });
    expect(textOf(declare.querySelector('p') as HTMLElement)).toBe(
      'Sur ta machine, jamais ici : ses secrets restent sur le Runner. Il s’attache ensuite aux Étapes, dans la Gestion du process de chaque Projet.',
    );
    expect((declare.querySelector('cd-code-block') as WithData).data).toEqual({ code: 'crewdeck-runner mcp add <nom> -- <commande>' });
  });

  it('keeps the Serveurs MCP as last reported while the Runner is offline', async () => {
    const el = await page({ ...ONLINE, runner: { ...RUNNER, state: 'offline' } });
    expect(rows(child(el, 'cd-card.mcp')).map((row) => row.title)).toEqual(['figma', 'stitch']);
  });

  it('places the Serveurs MCP first in the main column, then the Emplacement usage', async () => {
    const el = await page(ONLINE, { usage: '<p class="usage">Usage</p>' });
    const slot = inside<HTMLSlotElement>(el, '.main slot[name=usage]');
    expect(slot.assignedElements().map((node) => node.className)).toEqual(['usage']);
    expect(mainCards(el)).toEqual(['mcp', 'mcp-declare', 'usage', 'engines', 'connect']);
  });

  it('draws both MCP cards for each of its examples', async () => {
    for (const example of COMPOSANTS.PageRunner.examples) {
      const el = await page(example.data as Data);
      expect(mainCards(el).slice(0, 2), example.name).toEqual(['mcp', 'mcp-declare']);
      expect(rows(child(el, 'cd-card.mcp')).length, example.name).toBe(example.data.mcpServers.length);
      document.body.replaceChildren();
    }
  });

  it('shows no Runner card while none is linked', async () => {
    const el = await page({ ...ONLINE, runner: null });
    expect(el.shadowRoot?.querySelector('cd-card.runner')).toBeNull();
  });

  it('gives every Composant it holds its data', async () => {
    const el = await page(ONLINE);
    const held = all(el, '*').filter((node) => node.tagName.startsWith('CD-'));
    expect(held.filter((node) => node.data === undefined).map((node) => node.outerHTML.slice(0, 40))).toEqual([]);
  });
});
