import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const projet = (page: Page) => page.locator('cd-page-projet');
const readiness = (page: Page) => projet(page).locator('cd-card.readiness');
const check = (page: Page, id: string) => readiness(page).locator(`cd-list-row[data-check="${id}"]`);
const blocked = (page: Page) => projet(page).locator('cd-banner.blocked');

/** PROJET-3: what a Projet's Process still misses, on its page and in « Projets », fixed on one click where it is made. */
test.describe('A Projet’s readiness (US-3)', () => {
  test('a GitHub Projet without its integration branch: one point to fix, its Banner; « Corriger » creates it and the Projet is ready', async ({ page, scenario, expectAccessible }) => {
    await scenario('projet');

    await expect(projet(page).getByRole('heading', { level: 1, name: 'Site mairie' })).toBeVisible();
    await expect(projet(page)).toContainText('1 point à régler');
    await expect(blocked(page)).toContainText('Le Process ne peut pas démarrer');
    await expect(blocked(page)).toContainText('Il manque la branche d’intégration develop');
    await expect(readiness(page)).toContainText('Ce dont le Process a besoin');
    await expect(check(page, 'runner-linked')).toContainText('en ligne · atelier-pc');
    await expect(check(page, 'labels')).toContainText('labels du Process présents sur GitHub');
    await expect(check(page, 'branches')).toContainText('main présente · develop absente');
    await expectAccessible(page);

    await check(page, 'branches').getByRole('button', { name: 'Corriger' }).click();

    await expect(check(page, 'branches')).toContainText('main et develop présentes');
    await expect(projet(page)).toContainText('prêt');
    await expect(blocked(page)).toHaveCount(0);
    await expect(readiness(page).getByRole('button', { name: 'Corriger' })).toHaveCount(0);
  });

  test('« Process » leads to its Gestion du process', async ({ page, scenario }) => {
    await scenario('projet');

    await check(page, 'process').getByRole('link').click();
    await expect(page).toHaveURL(/\/projets\/[0-9a-f-]{36}\/process$/);
  });

  test('« Projets »: each Projet’s badge, the first point to fix, the Inventaire to approve', async ({ page, scenario }) => {
    await scenario('projets');

    const rows = page.locator('cd-page-projets cd-list-row');
    await expect(rows.filter({ hasText: 'Crewdeck' })).toContainText('prêt');
    await expect(rows.filter({ hasText: 'Site mairie' })).toContainText('1 point à régler : branche d’intégration absente');
    await expect(rows.filter({ hasText: 'Site mairie' })).toContainText('à régler');
    await expect(rows.filter({ hasText: 'Tennis Manager' })).toContainText('Inventaire à approuver avant le Process');
  });

  test('a Local Projet whose folder is not a git repository: « Corriger » makes it one on the Runner, and the Projet is ready', async ({ page, scenario, expectAccessible }) => {
    await scenario('projet-local-a-preparer');

    await expect(projet(page).getByRole('heading', { level: 1, name: 'Recettes' })).toBeVisible();
    await expect(check(page, 'folder')).toContainText('pas encore un dépôt git');
    await expect(blocked(page)).toContainText('atelier-pc');
    await expectAccessible(page);

    await check(page, 'folder').getByRole('button', { name: 'Corriger' }).click();

    await expect(check(page, 'folder')).toContainText('sur atelier-pc · lu par le Runner');
    await expect(projet(page)).toContainText('prêt');
    await expect(blocked(page)).toHaveCount(0);
  });

  test('a Local Projet ready: every row met, no Banner', async ({ page, scenario }) => {
    await scenario('projet-local');

    await expect(projet(page)).toContainText('prêt');
    await expect(blocked(page)).toHaveCount(0);
    await expect(readiness(page).locator('cd-list-row')).toHaveCount(4);
  });
});
