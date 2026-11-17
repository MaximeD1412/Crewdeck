/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, type ComposantData, type PageAjouterProjet } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, settle } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof PageAjouterProjet>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const [DOSSIER, GITHUB] = COMPOSANTS.PageAjouterProjet.examples.map((example) => example.data as Data);
const page = (data: Data) => render(COMPOSANTS.PageAjouterProjet, data);
const child = (el: Element, selector: string) => inside<WithData>(el, selector);

describe('PageAjouterProjet', () => {
  it('« Ajouter un Projet » back to « Projets », the Tabs, then the folder’s form', async () => {
    const el = await page(DOSSIER as Data);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Ajouter un Projet', back: { label: 'Projets', href: '/projets' } });
    expect(child(el, 'cd-tabs').data).toEqual({
      tabs: [
        { id: 'dossier', label: 'Dossier sur ta machine', selected: true },
        { id: 'github', label: 'Dépôt GitHub', selected: false },
      ],
    });
    expect(child(el, 'cd-folder-project-form').data).toEqual(DOSSIER?.folder);
    expect(el.shadowRoot?.querySelector('cd-repository-picker')).toBeNull();
  });

  it('the « Dépôt GitHub » tab shows the RepositoryPicker, whose actions go on up', async () => {
    const el = await page(GITHUB as Data);
    expect(child(el, 'cd-repository-picker').data).toEqual(GITHUB?.picker);
    expect(el.shadowRoot?.querySelector('cd-folder-project-form')).toBeNull();
    inside<HTMLInputElement>(el, 'cd-repository-picker', 'cd-checkbox', 'input').click();
    await settle(el);
    const details = await actionsOf(() => inside(el, 'cd-repository-picker', 'cd-button.follow', 'button').click());
    expect(details).toMatchObject([{ composant: 'RepositoryPicker', action: 'follow' }]);
  });

  it('a tab emits selectTab, not the Tabs’ select', async () => {
    const el = await page(DOSSIER as Data);
    expect(await actionsOf(() => inside(el, 'cd-tabs', 'button[role=tab]:nth-of-type(2)').click())).toEqual([
      { composant: 'PageAjouterProjet', action: 'selectTab', payload: { id: 'github' } },
    ]);
    expect(await actionsOf(() => inside(el, 'cd-tabs', 'button[role=tab]:nth-of-type(1)').click())).toEqual([
      { composant: 'PageAjouterProjet', action: 'selectTab', payload: { id: 'dossier' } },
    ]);
  });

  it('choosing a Projet’s folder again: « Choisir le dossier de <name> », the repick form only, no Tabs', async () => {
    const el = await page({ ...(GITHUB as Data), repick: { projectId: '019a6f00-0000-7000-8000-000000000021', name: 'Recettes' } });
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Choisir le dossier de Recettes', back: { label: 'Projets', href: '/projets' } });
    expect(el.shadowRoot?.querySelector('cd-tabs, cd-repository-picker')).toBeNull();
    expect(child(el, 'cd-folder-project-form').data).toMatchObject({ context: 'repick', name: 'Recettes' });
    expect(child(el, 'cd-folder-project-form').shadowRoot?.querySelector('cd-text-field.name')).toBeNull();
  });
});
