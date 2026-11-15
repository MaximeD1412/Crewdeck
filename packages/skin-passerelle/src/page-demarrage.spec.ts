/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, EXAMPLE_ENGINES, EXAMPLE_ENGINES_NONE, EXAMPLE_REPOSITORIES, t, type ComposantData, type EngineAccount, type PageDemarrage } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof PageDemarrage>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const COMMAND = 'curl -fsSL https://crewdeck.example/runner/install.sh | sh -s -- --link 7KQ4-M2PXA7QK9VZ3T8W4R6N1B5C0DE';
const WAITING: Data = {
  step: 'runner',
  login: 'octocat',
  system: 'linux',
  command: COMMAND,
  shortId: '7KQ4',
  failure: null,
  runner: null,
  busy: false,
  engines: [],
  usable: false,
  picker: { context: 'demarrage', repositories: [], installUrl: null, busy: false },
};
const RUNNER = {
  machine: 'atelier-pc',
  os: 'linux',
  arch: 'amd64',
  wsl: true,
  runnerVersion: '0.4.2',
  state: 'online',
  lastSeenAt: new Date().toISOString(),
} as const;

const page = (data: Data) => render(COMPOSANTS.PageDemarrage, data);
const child = (el: Element, selector: string) => inside<WithData>(el, selector);
const all = (el: Element, selector: string) => [...(el.shadowRoot?.querySelectorAll<WithData>(selector) ?? [])];
const steps = (el: Element) => (child(el, 'cd-process-track').data['steps'] as { label: string; state: string }[]).map((s) => `${s.label}:${s.state}`);

describe('PageDemarrage', () => {
  it('waits for the Runner: the compact track, the title, the systems, the command and « code 7KQ4 », and what stays with the Pilote', async () => {
    const el = await page(WAITING);
    expect(inside(el, 'nav').getAttribute('aria-label')).toBe(t('demarrage.steps'));
    expect(child(el, 'cd-process-track').data['direction']).toBe('compact');
    expect(steps(el)).toEqual(['Runner:current', 'Comptes IA:todo', 'Projets:todo']);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Installe le Runner' });
    expect(child(el, 'cd-tabs').data['tabs']).toEqual([
      { id: 'linux', label: 'Linux', selected: true },
      { id: 'macos', label: 'macOS', selected: false },
      { id: 'wsl', label: 'Windows (WSL)', selected: false },
    ]);
    expect(textOf(inside(el, '.help'))).toBe(t('demarrage.runner.help.linux'));
    expect(child(el, 'cd-code-block').data).toEqual({ code: COMMAND });
    expect(child(el, 'cd-check-row').data).toEqual({ name: 'En attente du Runner…', state: 'running', detail: 'code 7KQ4', href: null });
    expect(child(el, 'cd-card.yours').data['title']).toBe('Ce qui reste chez toi');
    expect(all(el, 'cd-list-row').map((row) => row.data['title'])).toEqual([
      'Les agents tournent sur ta machine',
      'Chiffré de bout en bout',
      'Aucun identifiant IA chez nous',
    ]);
    expect(el.shadowRoot?.querySelector('cd-banner')).toBeNull();
    expect(el.shadowRoot?.querySelector('cd-button')).toBeNull();
  });

  it.each([
    ['waiting', WAITING],
    ['failed', { ...WAITING, failure: { reason: 'expired', shortId: '9RTB' } }],
    ['linked', { ...WAITING, command: null, shortId: null, runner: RUNNER }],
  ] as const)('gives every Composant it holds its data, without which it renders nothing (%s)', async (_state, data) => {
    const el = await page(data as Data);
    const held = all(el, '*').filter((node) => node.tagName.startsWith('CD-'));
    expect(held.length).toBeGreaterThan(0);
    expect(held.filter((node) => node.data === undefined).map((node) => node.outerHTML.slice(0, 40))).toEqual([]);
  });

  it('shows no command before the page drew its code', async () => {
    const el = await page({ ...WAITING, command: null, shortId: null });
    expect(el.shadowRoot?.querySelector('cd-code-block')).toBeNull();
    expect(child(el, 'cd-check-row').data['detail']).toBeNull();
  });

  it.each([
    ['macos', t('demarrage.runner.help.macos')],
    ['wsl', t('demarrage.runner.help.wsl')],
  ] as const)('gives the same command with the help of %s', async (system, help) => {
    const el = await page({ ...WAITING, system });
    expect(textOf(inside(el, '.help'))).toBe(help);
    expect(child(el, 'cd-code-block').data).toEqual({ code: COMMAND });
  });

  it('turns the Tabs’ select into selectSystem, and nothing else', async () => {
    const el = await page(WAITING);
    const details = await actionsOf(() => inside(el, 'cd-tabs', 'button[role=tab]:nth-of-type(3)').click());
    expect(details).toEqual([{ composant: 'PageDemarrage', action: 'selectSystem', payload: { system: 'wsl' } }]);
  });

  it.each([
    ['expired', 'Code de liaison expiré', 'Le code 9RTB a expiré avant que le Runner se relie. Relance la commande avec ce nouveau code.'],
    ['already-used', 'Code de liaison déjà utilisé', 'Le code 9RTB a déjà servi. Relance la commande avec ce nouveau code.'],
    ['unsupported-system', 'Système non pris en charge', t('demarrage.runner.failure.unsupported-system.text')],
    ['no-engine', 'Aucun Moteur trouvé', t('demarrage.runner.failure.no-engine.text')],
  ] as const)('after a link failed (%s), shows its halt Banner above the new command, and « Réessayer »', async (reason, title, text) => {
    const el = await page({ ...WAITING, failure: { reason, shortId: '9RTB' } });
    expect(steps(el)).toEqual(['Runner:halt', 'Comptes IA:todo', 'Projets:todo']);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'La liaison a échoué' });
    const banner = child(el, 'cd-banner');
    expect(banner.data).toEqual({ tone: 'halt', icon: 'alert', title });
    expect(textOf(banner)).toBe(text);
    expect(child(el, 'cd-code-block').data).toEqual({ code: COMMAND });
    expect(banner.compareDocumentPosition(child(el, 'cd-code-block')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(child(el, 'cd-button.retry').data).toMatchObject({ label: 'Réessayer', variant: 'primary', icon: 'refresh' });
    expect(el.shadowRoot?.querySelector('cd-check-row')).toBeNull();
    const details = await actionsOf(() => inside(el, 'cd-button.retry', 'button').click());
    expect(details).toEqual([{ composant: 'PageDemarrage', action: 'retry', payload: {} }]);
  });

  it('says « Le Runner n’a pas pu s’installer » for an unsupported system', async () => {
    const el = await page({ ...WAITING, failure: { reason: 'unsupported-system', shortId: '9RTB' } });
    expect(textOf(inside(el, '[part=lead]'))).toBe(t('demarrage.runner.failed.leadUnsupported'));
  });

  it('once linked, shows the Runner online, its machine, system and version, and « Continuer »', async () => {
    const el = await page({ ...WAITING, command: null, shortId: null, runner: RUNNER });
    expect(steps(el)).toEqual(['Runner:done', 'Comptes IA:current', 'Projets:todo']);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Runner relié' });
    expect(textOf(inside(el, '[part=lead]'))).toBe('Ton Runner est en ligne et relié à ton compte octocat.');
    const banner = child(el, 'cd-banner');
    expect(banner.data).toEqual({ tone: 'go', icon: 'check', title: 'Runner en ligne' });
    expect(textOf(banner)).toBe("Il a répondu à l'instant.");
    expect(child(el, 'cd-key-value').data['items']).toEqual([
      { label: 'Machine', value: 'atelier-pc', mono: false },
      { label: 'Système', value: 'Windows (WSL) · amd64', mono: false },
      { label: 'Version', value: 'Runner 0.4.2', mono: false },
    ]);
    expect(el.shadowRoot?.querySelector('cd-code-block')).toBeNull();
    const details = await actionsOf(() => inside(el, 'cd-button.continue', 'button').click());
    expect(details).toEqual([{ composant: 'PageDemarrage', action: 'continue', payload: {} }]);
  });

  it('says a linked Runner not connected yet, on macOS', async () => {
    const el = await page({ ...WAITING, runner: { ...RUNNER, state: 'offline', os: 'darwin', arch: 'arm64', wsl: false } });
    expect(child(el, 'cd-banner').data).toMatchObject({ tone: 'caution', title: 'Runner pas encore connecté' });
    expect(textOf(inside(el, '[part=lead]'))).toBe('Ton Runner est relié à ton compte octocat.');
    expect((child(el, 'cd-key-value').data['items'] as { value: string }[])[1]?.value).toBe('macOS · arm64');
  });

  it('while busy, « Continuer » is loading and emits nothing', async () => {
    const el = await page({ ...WAITING, runner: RUNNER, busy: true });
    expect(child(el, 'cd-button.continue').data).toMatchObject({ state: 'loading' });
    expect(await actionsOf(() => child(el, 'cd-button.continue').click())).toEqual([]);
  });

  it('the projects step shows the RepositoryPicker of « picker » under its title and explanation; its follow goes up', async () => {
    const picker: Data['picker'] = {
      context: 'demarrage',
      repositories: [...EXAMPLE_REPOSITORIES],
      installUrl: 'https://github.com/apps/crewdeck/installations/new?state=demarrage',
      busy: false,
    };
    const el = await page({ ...WAITING, step: 'projects', runner: RUNNER, picker });
    expect(steps(el)).toEqual(['Runner:done', 'Comptes IA:done', 'Projets:current']);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Choisis tes Projets' });
    expect(textOf(inside(el, 'p[part=lead]'))).toBe(t('demarrage.projects.lead'));
    expect(child(el, 'cd-repository-picker').data).toEqual(picker);
    expect(el.shadowRoot?.querySelector('cd-tabs')).toBeNull();
    inside<HTMLInputElement>(el, 'cd-repository-picker', `cd-checkbox[data-repository="${EXAMPLE_REPOSITORIES[0].id}"]`, 'input').click();
    await settle(el);
    expect(await actionsOf(() => inside(el, 'cd-repository-picker', 'cd-button.follow', 'button').click())).toEqual([
      { composant: 'RepositoryPicker', action: 'follow', payload: { repositoryIds: [EXAMPLE_REPOSITORIES[0].id] } },
    ]);
  });

  it('the projects step: « Plus tard » is the page’s continue; busy, the picker waits', async () => {
    const el = await page({ ...WAITING, step: 'projects', runner: RUNNER });
    expect(await actionsOf(() => inside(el, 'cd-repository-picker', 'cd-button.later', 'button').click())).toEqual([
      { composant: 'PageDemarrage', action: 'continue', payload: {} },
    ]);
    const busy = await page({ ...WAITING, step: 'projects', runner: RUNNER, busy: true });
    expect(child(busy, 'cd-repository-picker').data['busy']).toBe(true);
    expect(await actionsOf(() => inside(busy, 'cd-repository-picker', 'cd-button.later').click())).toEqual([]);
  });
});

describe('PageDemarrage, the Comptes IA step', () => {
  const ACCOUNTS: Data = { ...WAITING, step: 'ai-accounts', command: null, shortId: null, runner: RUNNER, engines: [...EXAMPLE_ENGINES], usable: true };
  const NONE: Data = { ...ACCOUNTS, engines: [...EXAMPLE_ENGINES_NONE], usable: false };

  const card = (el: Element, engine: string) => child(el, `cd-card[data-engine=${engine}]`);
  const badges = (host: Element) => [...host.querySelectorAll<WithData>('cd-status-badge[slot=actions]')].map((badge) => badge.data);
  const rows = (host: Element) =>
    [...host.querySelectorAll<WithData>('cd-list-row')].map((row) => ({
      title: row.data['title'],
      meta: row.data['meta'],
      badge: (row.querySelector('cd-status-badge') as WithData | null)?.data,
    }));

  it('shows each Moteur, its Compte IA, its models and why one is not usable, and the command of the one not connected', async () => {
    const el = await page(ACCOUNTS);
    expect(steps(el)).toEqual(['Runner:done', 'Comptes IA:current', 'Projets:todo']);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Connecte tes Comptes IA' });
    expect(textOf(inside(el, '[part=lead]'))).toBe('Tu les connectes sur le Runner, jamais dans le navigateur. Voici ce qu’il voit, Moteur par Moteur.');
    const claude = card(el, 'claude-code');
    expect(claude.data).toEqual({ title: 'Claude Code', flush: true });
    expect(badges(claude)).toEqual([{ tone: 'go', label: 'connecté · abonnement' }]);
    expect(rows(claude)).toEqual([
      { title: 'claude-opus-5-5', meta: undefined, badge: { tone: 'go', label: 'disponible' } },
      { title: 'claude-sonnet-5-5', meta: undefined, badge: { tone: 'go', label: 'disponible' } },
      { title: 'claude-fable-5-1', meta: 'indisponible avec cet abonnement', badge: { tone: 'halt', label: 'indisponible' } },
    ]);
    expect(claude.querySelector('cd-code-block')).toBeNull();
    const codex = card(el, 'codex');
    expect(codex.data).toEqual({ title: 'Codex', flush: true });
    expect(badges(codex)).toEqual([{ tone: 'caution', label: 'connexion requise' }]);
    expect(textOf(codex.querySelector('p') as HTMLElement)).toBe('Avec ta clé API :');
    expect((codex.querySelector('cd-code-block') as WithData).data).toEqual({ code: 'crewdeck-runner login codex' });
    expect(el.shadowRoot?.querySelector('cd-banner')).toBeNull();
    expect(textOf(inside(el, '.help'))).toBe(t('demarrage.aiAccounts.help'));
    expect(child(el, 'cd-button.continue').data).not.toHaveProperty('state');
    const details = await actionsOf(() => inside(el, 'cd-button.continue', 'button').click());
    expect(details).toEqual([{ composant: 'PageDemarrage', action: 'continue', payload: {} }]);
  });

  it('without a usable Moteur, shows the caution Banner, both commands, and a disabled « Continuer » that emits nothing', async () => {
    const el = await page(NONE);
    const banner = child(el, 'cd-banner');
    expect(banner.data).toEqual({ tone: 'caution', icon: 'alert', title: 'Aucun Moteur utilisable' });
    expect(textOf(banner)).toBe(t('demarrage.aiAccounts.none.text'));
    expect(textOf(card(el, 'claude-code').querySelector('p') as HTMLElement)).toBe('Avec ton abonnement Claude ou ta clé API :');
    expect(all(el, 'cd-code-block').map((block) => block.data['code'])).toEqual(['crewdeck-runner login claude', 'crewdeck-runner login codex']);
    expect(child(el, 'cd-button.continue').data).toMatchObject({ label: 'Continuer', state: 'disabled' });
    expect(textOf(inside(el, '.help'))).toBe('« Continuer » s’active dès qu’un Moteur peut tourner.');
    expect(await actionsOf(() => inside(el, 'cd-button.continue', 'button').click())).toEqual([]);
  });

  it('says « connecté · clé API », a quota reached, a version it does not know, and a Moteur not installed', async () => {
    const [claude] = EXAMPLE_ENGINES as [EngineAccount, EngineAccount];
    const el = await page({
      ...ACCOUNTS,
      engines: [
        { ...claude, kind: 'api-key', knownVersion: false, models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', usable: false, reason: 'quota-reached' }] },
        { engine: 'codex', installed: false, knownVersion: true, kind: 'none', state: 'login-required', models: [], command: 'crewdeck-runner login codex' },
      ],
    });
    expect(badges(card(el, 'claude-code'))).toEqual([
      { tone: 'go', label: 'connecté · clé API' },
      { tone: 'caution', label: 'version non vérifiée' },
    ]);
    expect(rows(card(el, 'claude-code'))).toEqual([{ title: 'claude-opus-5-5', meta: undefined, badge: { tone: 'caution', label: 'quota atteint' } }]);
    expect(badges(card(el, 'codex'))).toEqual([{ tone: 'caution', label: 'non installé' }]);
  });

  it.each([
    ['some usable', ACCOUNTS],
    ['none usable', NONE],
  ] as const)('gives every Composant it holds its data (%s)', async (_state, data) => {
    const el = await page(data);
    const held = all(el, '*').filter((node) => node.tagName.startsWith('CD-'));
    expect(held.filter((node) => node.data === undefined).map((node) => node.outerHTML.slice(0, 40))).toEqual([]);
  });
});
