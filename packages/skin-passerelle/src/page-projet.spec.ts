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
};
const GITHUB: Data = {
  ...LOCAL,
  id: '019a6f00-0000-7000-8000-000000000011',
  name: 'Personal OS',
  fullName: 'MaximeD1412/personal-os',
  folder: null,
  connectors: ['github'],
};

const page = (data: Data) => render(COMPOSANTS.PageProjet, data);
const child = (el: Element, selector: string) => inside<WithData>(el, selector);
const items = (el: Element) => child(el, 'cd-key-value').data['items'];

describe('PageProjet', () => {
  it('its name, back to « Projets », and « Gestion du process » emitting openProcess', async () => {
    const el = await page(LOCAL);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Recettes', back: { label: 'Projets', href: '/projets' } });
    expect(child(el, 'cd-button.process').data).toMatchObject({ label: 'Gestion du process' });
    expect(await actionsOf(() => inside(el, 'cd-button.process', 'button').click())).toEqual([{ composant: 'PageProjet', action: 'openProcess', payload: {} }]);
  });

  it('a Local Projet: « Dossier » on its machine (never its path), no Connecteur, since when, and the Banner of its files', async () => {
    const el = await page(LOCAL);
    expect(child(el, 'cd-card').data).toMatchObject({ title: 'Projet' });
    expect(items(el)).toEqual([
      { label: 'Dossier', value: 'sur atelier-pc', mono: false },
      { label: 'Connecteurs', value: 'aucun : tout est Local', mono: false },
      { label: 'Suivi depuis', value: formatDateOfAnyYear(LOCAL.followedAt), mono: false },
    ]);
    expect(child(el, 'cd-banner').data).toEqual({ tone: 'neutral', icon: 'folder', title: 'Des fichiers que tu lis à la main' });
    expect(textOf(inside(el, 'cd-banner'))).toBe(
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
    expect(el.shadowRoot?.querySelector('cd-banner')).toBeNull();
  });
});
