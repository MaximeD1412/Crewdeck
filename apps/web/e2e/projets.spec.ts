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
    await expect(picker(page).getByRole('heading', { level: 1, name: 'Ajouter un Projet' })).toBeVisible();
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
    await expect(rows(page).filter({ hasText: 'octocat/sandbox-vue3' })).toHaveCount(1);
  });

  test('the picker without any repository: the Empty and the link to install the App', async ({ page, scenario, expectAccessible }) => {
    await scenario('projets');
    // Every repository of the installation followed: nothing left to add.
    await list(page).getByRole('button', { name: 'Ajouter un Projet' }).click();
    await repository(page, 'sandbox-vue3').check();
    await picker(page).getByRole('button', { name: 'Suivre 1 Projet' }).click();
    await expect(page).toHaveURL('/projets');
    await list(page).getByRole('button', { name: 'Ajouter un Projet' }).click();

    await expect(picker(page)).toContainText('Installe Crewdeck sur tes dépôts GitHub');
    await expect(picker(page).getByRole('link', { name: 'Installer Crewdeck sur GitHub' })).toHaveAttribute('href', /installations\/new\?state=projets$/);
    await expect(picker(page).getByRole('button', { name: 'Plus tard' })).toHaveCount(0);
    await expectAccessible(page);
  });
});
