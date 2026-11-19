/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, formatDateOfAnyYear, type ComposantData, type PageProjet } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof PageProjet>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const LOCAL: Data = {
  id: '019a6f00-0000-7000-8000-000000000021',
  name: 'Recettes',
  fullName: null,
  folder: { state: 'present', machine: 'atelier-pc' },
  connectors: [],
  followedAt: '2026-11-10T09:00:00.000Z',
  readiness: { count: 'prêt', blocked: null, rows: [], fixing: null },
};
const GITHUB: Data = {
  ...LOCAL,
  id: '019a6f00-0000-7000-8000-000000000011',
  name: 'Personal OS',
  fullName: 'MaximeD1412/personal-os',
  folder: null,
  connectors: ['github'],
};

const READINESS: Data['readiness'] = {
  count: '2 points à régler',
  blocked: 'Il manque la branche d’intégration develop.',
  fixing: null,
  rows: [
    { id: 'branches', state: 'missing', title: 'Branches d’intégration et de release', meta: 'main présente · develop absente', fix: true, href: null },
    { id: 'engines', state: 'missing', title: 'Un Moteur utilisable par Rôle', meta: 'sans Moteur utilisable : Code', fix: false, href: '/projets/p/parametres' },
    { id: 'labels', state: 'pending', title: 'Labels', meta: 'lecture de GitHub en cours', fix: false, href: null },
    { id: 'process', state: 'ok', title: 'Process', meta: 'v3 active · aucun Manque', fix: false, href: '/projets/p/process' },
  ],
};

const page = (data: Data) => render(COMPOSANTS.PageProjet, data);
const child = (el: Element, selector: string) => inside<WithData>(el, selector);
const items = (el: Element) => child(el, 'cd-key-value').data['items'];

describe('PageProjet', () => {
  it('its name, back to « Projets », and « Gestion du process » emitting openProcess', async () => {
    const el = await page(LOCAL);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Recettes', count: 'prêt', back: { label: 'Projets', href: '/projets' } });
    expect(child(el, 'cd-button.process').data).toMatchObject({ label: 'Gestion du process' });
    expect(await actionsOf(() => inside(el, 'cd-button.process', 'button').click())).toEqual([{ composant: 'PageProjet', action: 'openProcess', payload: {} }]);
  });

  it('« Paramètres du Projet » emits openSettings', async () => {
    const el = await page(LOCAL);
    expect(child(el, 'cd-button.settings').data).toMatchObject({ label: 'Paramètres du Projet', icon: 'settings' });
    expect(await actionsOf(() => inside(el, 'cd-button.settings', 'button').click())).toEqual([{ composant: 'PageProjet', action: 'openSettings', payload: {} }]);
  });

  it('its readiness: the count in the header, the caution Banner naming the first point, a row per check', async () => {
    const el = await page({ ...GITHUB, readiness: READINESS });
    expect(child(el, 'cd-page-header').data).toMatchObject({ count: '2 points à régler' });
    expect(child(el, 'cd-banner.blocked').data).toEqual({ tone: 'caution', icon: 'alert', title: 'Le Process ne peut pas démarrer' });
    expect(textOf(inside(el, 'cd-banner.blocked'))).toBe('Il manque la branche d’intégration develop.');
    expect(child(el, 'cd-card.readiness').data).toMatchObject({ title: 'Ce dont le Process a besoin', flush: true });
    const rows = [...(el.shadowRoot?.querySelectorAll<WithData>('cd-card.readiness cd-list-row') ?? [])];
    expect(rows.map((row) => row.data)).toEqual([
      { title: 'Branches d’intégration et de release', meta: 'main présente · develop absente', icon: 'alert', tone: 'caution' },
      { title: 'Un Moteur utilisable par Rôle', meta: 'sans Moteur utilisable : Code', icon: 'alert', tone: 'caution', href: '/projets/p/parametres' },
      { title: 'Labels', meta: 'lecture de GitHub en cours', icon: 'clock', tone: 'neutral' },
      { title: 'Process', meta: 'v3 active · aucun Manque', icon: 'check', tone: 'go', href: '/projets/p/process' },
    ]);
    const badges = rows.map((row) => row.querySelector<WithData>('cd-status-badge')?.data ?? null);
    expect(badges).toEqual([null, { tone: 'caution', label: 'à régler' }, { tone: 'neutral', label: 'en cours' }, { tone: 'go', label: 'ok' }]);
  });

  it('« Corriger » on a point fixed on one click emits fix, busy while it runs', async () => {
    const el = await page({ ...GITHUB, readiness: READINESS });
    const fix = () => inside<WithData>(el, 'cd-list-row[data-check="branches"] cd-button');
    expect(fix().data).toMatchObject({ label: 'Corriger', variant: 'primary', size: 'sm' });
    expect(await actionsOf(() => inside(el, 'cd-list-row[data-check="branches"] cd-button', 'button').click())).toEqual([
      { composant: 'PageProjet', action: 'fix', payload: { checkId: 'branches' } },
    ]);
    const busy = await page({ ...GITHUB, readiness: { ...READINESS, fixing: 'branches' } });
    expect(inside<WithData>(busy, 'cd-list-row[data-check="branches"] cd-button').data).toMatchObject({ state: 'loading' });
  });

  it('no Banner of a blocked Process when nothing is missing', async () => {
    const el = await page(GITHUB);
    expect(el.shadowRoot?.querySelector('cd-banner.blocked')).toBeNull();
    expect(child(el, 'cd-page-header').data).toMatchObject({ count: 'prêt' });
  });

  it('a Local Projet: « Dossier » on its machine (never its path), no Connecteur, since when, and the Banner of its files', async () => {
    const el = await page(LOCAL);
    expect(child(el, 'cd-card.projet').data).toMatchObject({ title: 'Projet' });
    expect(items(el)).toEqual([
      { label: 'Dossier', value: 'sur atelier-pc', mono: false },
      { label: 'Connecteurs', value: 'aucun : tout est Local', mono: false },
      { label: 'Suivi depuis', value: formatDateOfAnyYear(LOCAL.followedAt), mono: false },
    ]);
    expect(child(el, 'cd-banner.files').data).toEqual({ tone: 'neutral', icon: 'folder', title: 'Des fichiers que tu lis à la main' });
    expect(textOf(inside(el, 'cd-banner.files'))).toBe(
      'Les documents et les Tickets sont des fichiers Markdown du dossier ; une modification faite à la main s’affiche ici en moins de 2 s. Ce que le travail écrit (commentaires, remarques de review) reste sur ta machine.',
    );
  });

  it.each([
    ['pending', 'sur atelier-pc · en attente du Runner'],
    ['missing', 'sur atelier-pc · introuvable'],
  ] as const)('a folder %s says « %s »', async (state, value) => {
    const el = await page({ ...LOCAL, folder: { state, machine: 'atelier-pc' } });
    expect(items(el)).toContainEqual({ label: 'Dossier', value, mono: false });
  });

  it('a GitHub Projet: its Dépôt GitHub, its Connecteur, no Banner', async () => {
    const el = await page(GITHUB);
    expect(items(el)).toEqual([
      { label: 'Dépôt GitHub', value: 'MaximeD1412/personal-os', mono: false },
      { label: 'Connecteurs', value: 'GitHub', mono: false },
      { label: 'Suivi depuis', value: formatDateOfAnyYear(GITHUB.followedAt), mono: false },
    ]);
    expect(el.shadowRoot?.querySelector('cd-banner.files')).toBeNull();
  });
});
