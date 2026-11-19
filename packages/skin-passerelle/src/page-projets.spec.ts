/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type WithData = HTMLElement & { data: Record<string, unknown> };

const PROJECTS = [
  { id: '019a6f00-0000-7000-8000-000000000011', name: 'Personal OS', meta: 'MaximeD1412/personal-os', tone: 'go', badge: 'prêt' },
  { id: '019a6f00-0000-7000-8000-000000000021', name: 'Recettes', meta: '1 point à régler : dossier à préparer', tone: 'caution', badge: 'à régler' },
  { id: '019a6f00-0000-7000-8000-000000000031', name: 'Tennis Manager', meta: 'Inventaire à approuver avant le Process', tone: 'accent', badge: 'inventaire' },
  { id: '019a6f00-0000-7000-8000-000000000041', name: 'Atelier', meta: 'Local · sur atelier-pc', tone: 'neutral', badge: 'en cours' },
] as const;

const all = (el: Element, selector: string) => [...(el.shadowRoot?.querySelectorAll<WithData>(selector) ?? [])];

describe('PageProjets', () => {
  it('lists the Projets under « Prêts pour le Process ? », each a link to its page with its readiness, with the count', async () => {
    const el = await render(COMPOSANTS.PageProjets, { projects: [...PROJECTS] });
    expect(inside<WithData>(el, 'cd-page-header').data).toEqual({ title: 'Projets', count: '4 Projets' });
    expect(inside<WithData>(el, 'cd-card').data).toMatchObject({ title: 'Prêts pour le Process ?' });
    expect(all(el, 'cd-list-row').map((row) => row.data)).toEqual([
      { title: 'Personal OS', meta: 'MaximeD1412/personal-os', icon: 'check', tone: 'go', href: `/projets/${PROJECTS[0].id}` },
      { title: 'Recettes', meta: '1 point à régler : dossier à préparer', icon: 'alert', tone: 'caution', href: `/projets/${PROJECTS[1].id}` },
      { title: 'Tennis Manager', meta: 'Inventaire à approuver avant le Process', icon: 'doc', tone: 'accent', href: `/projets/${PROJECTS[2].id}` },
      { title: 'Atelier', meta: 'Local · sur atelier-pc', icon: 'clock', tone: 'neutral', href: `/projets/${PROJECTS[3].id}` },
    ]);
    expect(all(el, 'cd-list-row').map((row) => row.querySelector<WithData>('cd-status-badge')?.data)).toEqual([
      { tone: 'go', label: 'prêt' },
      { tone: 'caution', label: 'à régler' },
      { tone: 'accent', label: 'inventaire' },
      { tone: 'neutral', label: 'en cours' },
    ]);
    const one = await render(COMPOSANTS.PageProjets, { projects: PROJECTS.slice(0, 1) });
    expect(inside<WithData>(one, 'cd-page-header').data['count']).toBe('1 Projet');
  });

  it('« Ajouter un Projet » emits add', async () => {
    const el = await render(COMPOSANTS.PageProjets, { projects: [...PROJECTS] });
    expect(await actionsOf(() => inside(el, 'cd-button.add', 'button').click())).toEqual([{ composant: 'PageProjets', action: 'add', payload: {} }]);
  });

  it('without any Projet: the Empty « Aucun Projet suivi » and its « Ajouter un Projet »', async () => {
    const el = await render(COMPOSANTS.PageProjets, { projects: [] });
    expect(inside<WithData>(el, 'cd-page-header').data).toEqual({ title: 'Projets' });
    expect(inside<WithData>(el, 'cd-empty').data).toEqual({ icon: 'folder', title: 'Aucun Projet suivi' });
    expect(textOf(inside(el, 'cd-empty'))).toContain('Choisis un dossier de ta machine ou un dépôt GitHub : il devient un Projet, préparé pour son Process.');
    expect(all(el, 'cd-list-row')).toEqual([]);
    expect(await actionsOf(() => inside(el, 'cd-empty cd-button.add', 'button').click())).toEqual([{ composant: 'PageProjets', action: 'add', payload: {} }]);
  });
});
