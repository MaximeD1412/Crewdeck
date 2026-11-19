import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const list = (page: Page) => page.locator('cd-page-projets');
const picker = (page: Page) => page.locator('cd-repository-picker');
const rows = (page: Page) => list(page).locator('cd-list-row');
const repository = (page: Page, name: string) => picker(page).getByRole('checkbox', { name: new RegExp(`^octocat/${name}\\b`) });

/** US-3: the Projets followed, and the Dépôts GitHub that become Projets. */
test.describe('« Projets » (US-3)', () => {
  test('lists the Projets followed, by name, each linking to its page', async ({ page, scenario, expectAccessible }) => {
    await scenario('projets');

    await expect(list(page).getByRole('heading', { level: 1, name: 'Projets' })).toBeVisible();
    await expect(list(page)).toContainText('4 Projets');
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).nth(0)).toContainText('Crewdeck');
    await expect(rows(page).nth(0)).toContainText('octocat/crewdeck');
    await expect(rows(page).nth(3)).toContainText('Tennis Manager');
    await expect(rows(page).nth(1).getByRole('link')).toHaveAttribute('href', /^\/projets\/[0-9a-f-]{36}$/);
    await expectAccessible(page);
  });

  test('without a Projet, the empty state and its « Ajouter un Projet »', async ({ page, scenario, expectAccessible }) => {
    await scenario('projets-vide');

    await expect(list(page)).toContainText('Aucun Projet suivi');
    await expect(rows(page)).toHaveCount(0);
    await expectAccessible(page);

    await list(page).getByRole('button', { name: 'Ajouter un Projet' }).click();
    await expect(page).toHaveURL('/projets/ajouter');
  });

  test('« Ajouter un Projet »: the repositories not followed, searched, two followed become Projets in the list', async ({ page, scenario, expectAccessible }) => {
    await scenario('projets');
    await list(page).getByRole('button', { name: 'Ajouter un Projet' }).click();

    await expect(page).toHaveURL('/projets/ajouter');
    await expect(page.locator('cd-page-ajouter-projet').getByRole('heading', { level: 1, name: 'Ajouter un Projet' })).toBeVisible();
    // A Dépôt GitHub to follow: its tab first.
    await expect(page.locator('cd-page-ajouter-projet').getByRole('tab', { name: 'Dépôt GitHub' })).toHaveAttribute('aria-selected', 'true');
    await expect(picker(page).getByRole('checkbox')).toHaveCount(1);
    await expect(repository(page, 'sandbox-vue3')).toBeVisible();
    await expect(picker(page)).toContainText('vide');
    await expect(picker(page).getByRole('link', { name: 'Choisir d’autres dépôts sur GitHub' })).toHaveAttribute('href', /\/apps\/[^/]+\/installations\/new\?state=projets$/);
    await expect(picker(page).getByRole('button', { name: 'Suivre des Projets' })).toBeDisabled();
    await expectAccessible(page);

    await picker(page).getByRole('textbox', { name: 'Chercher un dépôt GitHub' }).fill('mairie');
    await expect(picker(page)).toContainText('Aucun dépôt GitHub ne correspond à « mairie ».');
    await picker(page).getByRole('textbox', { name: 'Chercher un dépôt GitHub' }).fill('sandbox');

    await repository(page, 'sandbox-vue3').check();
    await picker(page).getByRole('button', { name: 'Suivre 1 Projet' }).click();

    await expect(page).toHaveURL('/projets');
    await expect(list(page)).toContainText('5 Projets');
    await expect(rows(page).filter({ hasText: 'sandbox-vue3' })).toHaveCount(1);
  });

  test('the picker without any repository: the Empty and the link to install the App', async ({ page, scenario, expectAccessible }) => {
    await scenario('projets');
    // Every repository of the installation followed: nothing left to add.
    await list(page).getByRole('button', { name: 'Ajouter un Projet' }).click();
    await repository(page, 'sandbox-vue3').check();
    await picker(page).getByRole('button', { name: 'Suivre 1 Projet' }).click();
    await expect(page).toHaveURL('/projets');
    await list(page).getByRole('button', { name: 'Ajouter un Projet' }).click();
    // No Dépôt GitHub left: the folder's tab first.
    await page.locator('cd-page-ajouter-projet').getByRole('tab', { name: 'Dépôt GitHub' }).click();

    await expect(picker(page)).toContainText('Installe Crewdeck sur tes dépôts GitHub');
    await expect(picker(page).getByRole('link', { name: 'Installer Crewdeck sur GitHub' })).toHaveAttribute('href', /installations\/new\?state=projets$/);
    await expect(picker(page).getByRole('button', { name: 'Plus tard' })).toHaveCount(0);
    await expectAccessible(page);
  });
});

const RECETTES_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6b01';
const ajouter = (page: Page) => page.locator('cd-page-ajouter-projet');
const form = (page: Page) => page.locator('cd-folder-project-form');
const pathField = (page: Page) => form(page).getByRole('textbox', { name: 'Chemin du dossier' });

/** From the page: its Origin, as a page's POST carries it. */
const post = async (page: Page, path: string, data: unknown = {}) => {
  const response = await page.request.post(path, { data, headers: { origin: new URL(page.url()).origin } });
  expect(response.status(), await response.text()).toBeLessThan(300);
};

interface ApiProject {
  id: string;
  repositoryId: string | null;
  nameSealed: unknown;
  folder: string | null;
}
const apiProjects = async (page: Page): Promise<ApiProject[]> => ((await (await page.request.get('/api/projects')).json()) as { items: ApiProject[] }).items;

/** US-3, US-99: a Projet from a folder of the Runner's machine, its path checked by the Runner as it is typed. */
test.describe('« Ajouter un Projet », a folder of the Runner’s machine (US-3, US-99)', () => {
  test('checks each path through the Runner, creates « Recettes » from a git folder, its page then the list with its points to fix', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('projets-vide');
    await list(page).getByRole('button', { name: 'Ajouter un Projet' }).click();
    await ajouter(page).getByRole('tab', { name: 'Dossier sur ta machine' }).click();
    const create = form(page).getByRole('button', { name: 'Créer le Projet' });

    await pathField(page).fill('projets/recettes');
    await expect(form(page)).toContainText('Un chemin complet, depuis / ou ~.');
    await pathField(page).fill('~/projets/absent');
    await expect(form(page)).toContainText('Dossier introuvable sur atelier-pc.');
    await expect(create).toBeDisabled();
    await pathField(page).fill('~/projets/carnet');
    await expect(form(page)).toContainText('Pas encore un dépôt git : Crewdeck proposera git init.');
    await pathField(page).fill('~/projets/recettes');
    await expect(form(page)).toContainText('Dépôt git · déjà du code : un inventaire sera proposé.', { timeout: 1_000 });
    await expectAccessible(page);

    await form(page).getByRole('textbox', { name: 'Nom du Projet' }).fill('Recettes');
    await expect(form(page).getByRole('combobox', { name: 'Modèle de process' })).toHaveValue('process-crewdeck');
    await create.click();

    await expect(page).toHaveURL(/^.*\/projets\/[0-9a-f-]{36}$/);
    const projet = page.locator('cd-page-projet');
    await expect(projet.getByRole('heading', { level: 1, name: 'Recettes' })).toBeVisible();
    await expect(projet).toContainText('aucun : tout est Local');
    // The Runner keeps the folder: « present » in the snapshot, without the path anywhere.
    await expect.poll(async () => (await apiProjects(page)).map(({ repositoryId, folder }) => ({ repositoryId, folder }))).toEqual([{ repositoryId: null, folder: 'present' }]);
    const [created] = await apiProjects(page);
    expect(JSON.stringify(created)).not.toContain('recettes');
    expect(JSON.stringify(created)).not.toContain('Recettes');

    await page.goto('/projets');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Recettes');
    // Not ready yet (no Compte IA, its Process a draft): the list says its first point to fix (PROJET-3).
    await expect(rows(page).first()).toContainText('à régler');

    // The same folder again: another Projet's.
    await page.goto('/projets/ajouter');
    await ajouter(page).getByRole('tab', { name: 'Dossier sur ta machine' }).click();
    await pathField(page).fill('~/projets/recettes');
    await expect(form(page)).toContainText('Ce dossier est déjà celui d’un autre Projet.');
    await expect(form(page).getByRole('button', { name: 'Créer le Projet' })).toBeDisabled();
  });

  test('with the Runner offline, says so and « Créer le Projet » stays disabled', async ({ page, scenario }) => {
    await scenario('projets-vide');
    await post(page, '/api/testing/runner/disconnect');
    await page.goto('/projets/ajouter');
    await ajouter(page).getByRole('tab', { name: 'Dossier sur ta machine' }).click();

    await pathField(page).fill('~/projets/recettes');
    await expect(form(page)).toContainText('Ton Runner est hors ligne : démarre-le pour choisir un dossier.');
    await expect(form(page).getByRole('button', { name: 'Créer le Projet' })).toBeDisabled();
  });
});

/** ADR 0012: a Local Projet's page, its folder kept by the Runner; the folder gone, its Décision, resolved by choosing a folder again. */
test.describe('A Local Projet (US-3, US-99)', () => {
  test('its page: its folder on atelier-pc, no Connecteur, « Gestion du process »', async ({ page, scenario, expectAccessible }) => {
    await scenario('projet-local');

    const projet = page.locator('cd-page-projet');
    await expect(projet.getByRole('heading', { level: 1, name: 'Recettes' })).toBeVisible();
    await expect(projet).toContainText('sur atelier-pc');
    await expect(projet).toContainText('aucun : tout est Local');
    await expect(projet).toContainText('Des fichiers que tu lis à la main');
    await expect(projet.getByRole('button', { name: 'Gestion du process' })).toBeVisible();
    await expectAccessible(page);
  });

  test('its folder deleted: « Dossier du Projet introuvable » in « À toi »; another folder chosen on its link resolves it', async ({ page, scenario }) => {
    await scenario('projet-local');
    await post(page, '/api/testing/runner/folders/remove', { path: '~/projets/recettes' });

    await page.goto('/a-toi');
    const decision = page.locator('cd-page-a-toi cd-decision-row').filter({ hasText: 'Dossier du Projet introuvable' });
    await expect(decision).toHaveCount(1);
    await expect(decision).toContainText('Choisis à nouveau son dossier');
    await expect(decision).toContainText('Recettes');
    await page.goto('/projets');
    await expect(rows(page).first()).toContainText('1 point à régler : dossier introuvable');

    await page.goto(`/projets/ajouter?projet=${RECETTES_ID}`);
    await expect(ajouter(page)).toContainText('Choisir le dossier de Recettes');
    await pathField(page).fill('~/projets/carnet');
    await expect(form(page)).toContainText('Pas encore un dépôt git');
    await form(page).getByRole('button', { name: 'Relier ce dossier' }).click();

    await expect.poll(async () => (await apiProjects(page)).map(({ folder }) => folder)).toEqual(['present']);
    await page.goto('/a-toi');
    await expect(page.locator('cd-page-a-toi cd-decision-row').filter({ hasText: 'Dossier du Projet introuvable' })).toHaveCount(0);
  });
});
