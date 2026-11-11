/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, t, type ComposantData, type PageDemarrage } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof PageDemarrage>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const COMMAND = 'curl -fsSL https://crewdeck.example/runner/install.sh | sh -s -- --link 7KQ4-M2PXA7QK9VZ3T8W4R6N1B5C0DE';
const WAITING: Data = { step: 'runner', login: 'octocat', system: 'linux', command: COMMAND, shortId: '7KQ4', failure: null, runner: null, busy: false };
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
      { label: 'Machine', value: 'atelier-pc', mono: true },
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

  it.each([
    ['ai-accounts', 'Connecte tes Comptes IA', ['Runner:done', 'Comptes IA:current', 'Projets:todo']],
    ['projects', 'Choisis tes Projets', ['Runner:done', 'Comptes IA:done', 'Projets:current']],
  ] as const)('the %s step shows an Empty and « Continuer » until its ticket', async (step, title, track) => {
    const el = await page({ ...WAITING, step, runner: RUNNER });
    expect(steps(el)).toEqual(track);
    expect(child(el, 'cd-page-header').data).toEqual({ title });
    expect(child(el, 'cd-empty').data['title']).toBe('Cette étape arrive bientôt');
    expect(el.shadowRoot?.querySelector('cd-tabs')).toBeNull();
    const details = await actionsOf(() => inside(el, 'cd-button.continue', 'button').click());
    expect(details).toEqual([{ composant: 'PageDemarrage', action: 'continue', payload: {} }]);
  });
});
