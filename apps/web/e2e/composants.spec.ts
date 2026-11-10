import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/**
 * A Card of the page by its title. Its content is slotted: under the `cd-card`
 * host, not under its shadow `section` (the region), which the accessibility
 * tree joins but a locator does not.
 */
const card = (page: Page, title: string) =>
  page.locator('cd-card').filter({ has: page.getByRole('heading', { level: 2, name: new RegExp(`^${title}`) }) });

test.describe('the library of Composants (/parametres/composants)', () => {
  test('lists the Composants by category and opens Banner from ?c=Banner, accessible', async ({ page, scenario, expectAccessible }) => {
    await scenario('composants');

    await expect(page.getByRole('heading', { level: 1, name: 'Bibliothèque de Composants' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Paramètres' })).toHaveAttribute('href', '/parametres');

    const catalogue = page.getByRole('navigation', { name: 'Catalogue des Composants' });
    await expect(catalogue.getByRole('heading', { level: 2 })).toHaveText([/^Cadre et menu/, /^Pages/, /^Parties de page/, /^Signaux et contrôles/]);
    for (const name of ['PageHeader', 'ProjectFilter', 'PageComposants', 'Card', 'Button', 'Tabs']) {
      await expect(catalogue.getByRole('link', { name: new RegExp(`^${name} `) })).toHaveAttribute('href', `/parametres/composants?c=${name}`);
    }
    await expect(catalogue.getByRole('link', { name: /^Banner .*ouvert$/ })).toBeVisible();

    await expect(page.getByRole('region', { name: 'Aperçu' })).toBeVisible();
    const preview = card(page, 'Aperçu');
    await expect(preview.locator('cd-banner')).toHaveCount(3);
    await expect(preview.getByRole('status').first()).toContainText('Resynchronisation');

    const data = card(page, 'Données');
    await expect(data.getByRole('columnheader')).toHaveText(['Nom', 'Type', 'Description']);
    await expect(data.getByRole('row')).toHaveText([
      /^\s*Nom\s+Type\s+Description\s*$/,
      /^\s*tone\s+Tone\s+\S/,
      /^\s*title\s+string\s+\S/,
      /^\s*icon\s+IconName \| undefined\s+\S/,
    ]);

    const slots = card(page, 'Emplacements');
    await expect(slots.locator('cd-list-row')).toHaveCount(2);
    await expect(slots).toContainText('default');
    await expect(slots).toContainText('actions');

    await expectAccessible(page);
  });

  test('a click on a row of the catalogue opens that Composant through ?c=', async ({ page, scenario, expectAccessible }) => {
    await scenario('composants');

    await page.getByRole('navigation', { name: 'Catalogue des Composants' }).getByRole('link', { name: /^Tabs / }).click();

    await expect(page).toHaveURL(/\/parametres\/composants\?c=Tabs$/);
    await expect(card(page, 'Aperçu').getByRole('tablist')).toHaveCount(1);
    await expect(card(page, 'Actions')).toContainText('select()');
    await expect(card(page, 'Actions')).toContainText('libre');
    await expectAccessible(page);

    await page.goBack();
    await expect(page).toHaveURL(/\?c=Banner$/);
    await expect(card(page, 'Aperçu').locator('cd-banner')).toHaveCount(3);
  });
});
