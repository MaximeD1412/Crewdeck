/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, EXAMPLE_REPOSITORIES, FOLLOW_PROJECTS_MAX, t, type ComposantData, type RepositoryPicker } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof RepositoryPicker>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const INSTALL_URL = 'https://github.com/apps/crewdeck/installations/new?state=projets';
const PICKER: Data = { context: 'projets', repositories: [...EXAMPLE_REPOSITORIES], installUrl: INSTALL_URL, busy: false };

const picker = (data: Data) => render(COMPOSANTS.RepositoryPicker, data);
const child = (el: Element, selector: string) => inside<WithData>(el, selector);
const all = (el: Element, selector: string) => [...(el.shadowRoot?.querySelectorAll<WithData>(selector) ?? [])];
const check = async (el: Element, id: string) => {
  inside<HTMLInputElement>(el, `cd-checkbox[data-repository="${id}"]`, 'input').click();
  await settle(el);
};
const search = async (el: Element, query: string) => {
  const input = inside<HTMLInputElement>(el, 'cd-text-field', 'input');
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle(el);
};
const follow = (el: Element) => inside(el, 'cd-button.follow', 'button');

describe('RepositoryPicker', () => {
  it('lists each repository with whether it has code, under « Tes dépôts GitHub », and nothing checked', async () => {
    const el = await picker(PICKER);
    expect(child(el, 'cd-card').data).toMatchObject({ title: 'Tes dépôts GitHub', count: 4, flush: true });
    expect(all(el, 'cd-checkbox').map((box) => [box.data['label'], box.data['meta'], box.data['checked']])).toEqual([
      ['MaximeD1412/personal-os', 'déjà du code · un inventaire sera proposé', false],
      ['MaximeD1412/site-mairie', 'déjà du code · un inventaire sera proposé', false],
      ['MaximeD1412/tennis-manager', 'déjà du code · un inventaire sera proposé', false],
      ['MaximeD1412/sandbox-vue3', 'vide', false],
    ]);
    expect(child(el, 'cd-text-field').data).toMatchObject({ label: 'Chercher un dépôt GitHub' });
    expect(textOf(inside(el, 'section > p.muted'))).toBe(t('projets.picker.footnote'));
    expect(inside<HTMLAnchorElement>(el, 'a.install').href).toBe(INSTALL_URL);
    expect(textOf(inside(el, 'a.install'))).toBe('Choisir d’autres dépôts sur GitHub');
  });

  it('on /projets/ajouter, under its own title back to the Projets and its explanation; no « Plus tard »', async () => {
    const el = await picker(PICKER);
    expect(child(el, 'cd-page-header').data).toEqual({ title: 'Ajouter un Projet', back: { label: 'Projets', href: '/projets' } });
    expect(textOf(inside(el, 'p[part=lead]'))).toBe(t('projets.picker.lead'));
    expect(el.shadowRoot?.querySelector('cd-button.later')).toBeNull();
  });

  it('« Suivre <n> Projets » follows what is checked; disabled with its reason at none', async () => {
    const el = await picker(PICKER);
    expect(child(el, 'cd-button.follow').data).toMatchObject({ label: 'Suivre des Projets', state: 'disabled', disabledReason: 'Coche au moins un dépôt GitHub.' });
    expect(await actionsOf(() => follow(el).click())).toEqual([]);
    await check(el, EXAMPLE_REPOSITORIES[0].id);
    expect(child(el, 'cd-button.follow').data).toMatchObject({ label: 'Suivre 1 Projet' });
    await check(el, EXAMPLE_REPOSITORIES[3].id);
    expect(child(el, 'cd-button.follow').data).toMatchObject({ label: 'Suivre 2 Projets' });
    expect(child(el, 'cd-button.follow').data).not.toHaveProperty('state');
    expect(await actionsOf(() => follow(el).click())).toEqual([
      { composant: 'RepositoryPicker', action: 'follow', payload: { repositoryIds: [EXAMPLE_REPOSITORIES[0].id, EXAMPLE_REPOSITORIES[3].id] } },
    ]);
    await check(el, EXAMPLE_REPOSITORIES[0].id);
    expect(child(el, 'cd-button.follow').data).toMatchObject({ label: 'Suivre 1 Projet' });
  });

  it('refuses more than FOLLOW_PROJECTS_MAX at once', async () => {
    const repositories = Array.from({ length: FOLLOW_PROJECTS_MAX + 1 }, (_, i) => ({
      id: `019a6f00-0000-7000-8000-${String(100 + i).padStart(12, '0')}`,
      fullName: `MaximeD1412/repo-${i}`,
      hasCode: false,
    }));
    const el = await picker({ ...PICKER, repositories });
    for (const { id } of repositories) await check(el, id);
    expect(child(el, 'cd-button.follow').data).toMatchObject({ state: 'disabled', disabledReason: `${FOLLOW_PROJECTS_MAX} au plus à la fois.` });
    expect(await actionsOf(() => follow(el).click())).toEqual([]);
  });

  it('the search filters the list in the page, what is checked staying checked', async () => {
    const el = await picker(PICKER);
    await check(el, EXAMPLE_REPOSITORIES[1].id);
    await search(el, 'TENNIS');
    expect(all(el, 'cd-checkbox').map((box) => box.data['label'])).toEqual(['MaximeD1412/tennis-manager']);
    expect(child(el, 'cd-button.follow').data).toMatchObject({ label: 'Suivre 1 Projet' });
    await search(el, 'nope');
    expect(all(el, 'cd-checkbox')).toEqual([]);
    expect(textOf(inside(el, '.no-match'))).toBe('Aucun dépôt GitHub ne correspond à « nope ».');
    await search(el, '');
    expect(all(el, 'cd-checkbox').find((box) => box.dataset['repository'] === EXAMPLE_REPOSITORIES[1].id)?.data['checked']).toBe(true);
  });

  it('forgets a checked repository once it leaves the list (followed)', async () => {
    const el = await picker(PICKER);
    await check(el, EXAMPLE_REPOSITORIES[0].id);
    await check(el, EXAMPLE_REPOSITORIES[1].id);
    (el as unknown as { data: Data }).data = { ...PICKER, repositories: EXAMPLE_REPOSITORIES.slice(1) };
    await settle(el);
    expect(child(el, 'cd-button.follow').data).toMatchObject({ label: 'Suivre 1 Projet' });
  });

  it('busy, « Suivre » waits and sends nothing', async () => {
    const el = await picker(PICKER);
    await check(el, EXAMPLE_REPOSITORIES[0].id);
    (el as unknown as { data: Data }).data = { ...PICKER, busy: true };
    await settle(el);
    expect(child(el, 'cd-button.follow').data).toMatchObject({ state: 'loading' });
    expect(await actionsOf(() => (inside(el, 'cd-button.follow') as HTMLElement).click())).toEqual([]);
  });

  it('without any repository: the Empty whose action is the installation on GitHub', async () => {
    const el = await picker({ ...PICKER, repositories: [] });
    expect(child(el, 'cd-empty').data).toEqual({ icon: 'folder', title: 'Installe Crewdeck sur tes dépôts GitHub' });
    const link = inside<HTMLAnchorElement>(el, 'cd-empty a.install');
    expect(link.href).toBe(INSTALL_URL);
    expect(textOf(link)).toBe('Installer Crewdeck sur GitHub');
    expect(el.shadowRoot?.querySelector('cd-checkbox, cd-button.follow')).toBeNull();
  });

  it('without the installation page known yet, no link', async () => {
    const el = await picker({ ...PICKER, installUrl: null });
    expect(el.shadowRoot?.querySelector('a.install')).toBeNull();
  });

  it('in « Premiers pas »: no title of its own, and « Plus tard » emits later, with or without repositories', async () => {
    for (const repositories of [[...EXAMPLE_REPOSITORIES], []]) {
      const el = await picker({ ...PICKER, context: 'demarrage', repositories });
      expect(el.shadowRoot?.querySelector('cd-page-header')).toBeNull();
      expect(child(el, 'cd-button.later').data).toMatchObject({ label: 'Plus tard', variant: 'ghost' });
      expect(await actionsOf(() => inside(el, 'cd-button.later', 'button').click())).toEqual([{ composant: 'RepositoryPicker', action: 'later', payload: {} }]);
      el.remove();
    }
  });
});
