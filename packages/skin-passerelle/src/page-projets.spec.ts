/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type WithData = HTMLElement & { data: Record<string, unknown> };

const PROJECTS = [
  { id: '019a6f00-0000-7000-8000-000000000011', displayName: 'Personal OS', fullName: 'MaximeD1412/personal-os' },
  { id: '019a6f00-0000-7000-8000-000000000012', displayName: 'Crewdeck', fullName: 'MaximeD1412/crewdeck' },
];

const all = (el: Element, selector: string) => [...(el.shadowRoot?.querySelectorAll<WithData>(selector) ?? [])];

describe('PageProjets', () => {
  it('lists the Projets under « Prêts pour le Process ? », each a link to its page, with the count', async () => {
    const el = await render(COMPOSANTS.PageProjets, { projects: PROJECTS });
    expect(inside<WithData>(el, 'cd-page-header').data).toEqual({ title: 'Projets', count: '2 Projets' });
    expect(inside<WithData>(el, 'cd-card').data).toMatchObject({ title: 'Prêts pour le Process ?' });
    expect(all(el, 'cd-list-row').map((row) => row.data)).toEqual([
      { title: 'Personal OS', meta: 'MaximeD1412/personal-os', href: `/projets/${PROJECTS[0]?.id}` },
      { title: 'Crewdeck', meta: 'MaximeD1412/crewdeck', href: `/projets/${PROJECTS[1]?.id}` },
    ]);
    const one = await render(COMPOSANTS.PageProjets, { projects: PROJECTS.slice(0, 1) });
    expect(inside<WithData>(one, 'cd-page-header').data['count']).toBe('1 Projet');
  });

  it('« Ajouter un Projet » emits add', async () => {
    const el = await render(COMPOSANTS.PageProjets, { projects: PROJECTS });
    expect(await actionsOf(() => inside(el, 'cd-button.add', 'button').click())).toEqual([{ composant: 'PageProjets', action: 'add', payload: {} }]);
  });

  it('without any Projet: the Empty « Aucun Projet suivi » and its « Ajouter un Projet »', async () => {
    const el = await render(COMPOSANTS.PageProjets, { projects: [] });
    expect(inside<WithData>(el, 'cd-page-header').data).toEqual({ title: 'Projets' });
    expect(inside<WithData>(el, 'cd-empty').data).toEqual({ icon: 'folder', title: 'Aucun Projet suivi' });
    expect(textOf(inside(el, 'cd-empty'))).toContain('il devient un Projet');
    expect(all(el, 'cd-list-row')).toEqual([]);
    expect(await actionsOf(() => inside(el, 'cd-empty cd-button.add', 'button').click())).toEqual([{ composant: 'PageProjets', action: 'add', payload: {} }]);
  });
});
