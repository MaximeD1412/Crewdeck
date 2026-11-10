import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const ALL = ['À toi', 'Idées', 'Conceptions', 'Boucle', 'Planning', 'Statistiques', 'Projets', 'Runner et Comptes IA', 'Paramètres'];

/** The entries of the menu the Pilote sees: the sidebar at 1280, the tab bar at 390. */
const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu' });

test.describe('the Cadre at 1280 px', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, 'the sidebar: 1280 px');

  test('the sidebar: the nine entries in order with the separator, Paramètres current, the Runner offline, accessible', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('a-toi-menu-plus');

    await expect(page.getByRole('banner')).toBeHidden();
    await expect(menu(page).getByRole('link')).toHaveText(ALL);
    await expect(menu(page).getByRole('separator')).toHaveCount(1);
    const current = menu(page).locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Paramètres');
    await expect(menu(page).getByRole('link', { name: 'Planning' })).toHaveAttribute('href', '/planning');
    await expect(page.getByText('Runner hors ligne')).toBeVisible();
    await expect(page.getByText('En direct')).toBeHidden();
    await expect(page.getByRole('main', { name: 'Paramètres' })).toBeVisible();
    await expectAccessible(page);
  });

  test('the keyboard goes through the entries in order, then the page', async ({ page, scenario }) => {
    await scenario('a-toi-menu-plus');

    for (const label of ALL) {
      await page.keyboard.press('Tab');
      await expect(menu(page).getByRole('link', { name: label })).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(page.getByRole('main').getByRole('link', { name: 'Paramètres' })).toBeFocused();
  });

  test('a click on an entry opens its page and marks it current', async ({ page, scenario }) => {
    await scenario('a-toi-menu-plus');

    await menu(page).getByRole('link', { name: 'Idées' }).click();
    await expect(page).toHaveURL(/\/idees$/);
    await expect(menu(page).locator('[aria-current="page"]')).toHaveText('Idées');
  });

  test('the library shows the Cadre’s examples, the Pilote at the foot of the default one', async ({ page }) => {
    await page.goto('/parametres/composants?c=Cadre');

    const preview = page.locator('cd-card').filter({ has: page.getByRole('heading', { level: 2, name: /^Aperçu/ }) });
    await expect(preview.locator('cd-cadre')).toHaveCount(4);
    await expect(preview.getByRole('button', { name: 'maximed1412' }).first()).toBeVisible();
    await expect(preview.getByText('Resynchronisation…')).toBeVisible();
    await expect(preview.getByText('Actions sensibles indisponibles')).toBeVisible();
  });
});

test.describe('the Cadre at 390 px', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1280, 'the tab bar: 390 px');

  test('the top bar and the tab bar: four entries and « Plus », accessible', async ({ page, scenario, expectAccessible }) => {
    await scenario('a-toi-menu-plus');

    await expect(page.getByRole('banner')).toContainText('Runner hors ligne');
    await expect(menu(page).getByRole('link')).toHaveText(['À toi', 'Idées', 'Conceptions', 'Boucle']);
    await expect(menu(page).getByRole('button', { name: 'Plus' })).toBeVisible();
    for (const box of await Promise.all([...(await menu(page).getByRole('link').all()), menu(page).getByRole('button')].map((target) => target.boundingBox()))) {
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    await expectAccessible(page);
  });

  test('« Plus » opens the sheet with the five other entries and their metas, accessible; Escape closes it, back to « Plus »', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('a-toi-menu-plus');

    const more = menu(page).getByRole('button', { name: 'Plus' });
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'Plus' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link')).toHaveText([
      /^Planning\s*Jalons et arbre des Tickets$/,
      /^Statistiques\s*Délai, réussite de la Boucle, coût$/,
      /^Projets$/,
      /^Runner et Comptes IA$/,
      /^Paramètres\s*Rôles, notifications, Planifications$/,
    ]);
    await expect(sheet.locator('[aria-current="page"]')).toContainText('Paramètres');
    await expectAccessible(page);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('the keyboard opens the sheet, goes through it, and « Fermer » closes it, back to « Plus »', async ({ page, scenario }) => {
    await scenario('a-toi-menu-plus');

    const more = menu(page).getByRole('button', { name: 'Plus' });
    await more.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Plus' });
    await expect(sheet).toBeVisible();
    const close = sheet.getByRole('button', { name: 'Fermer' });
    await expect(close).toBeFocused();
    for (const label of ['Planning', 'Statistiques', 'Projets', 'Runner et Comptes IA', 'Paramètres']) {
      await page.keyboard.press('Tab');
      await expect(sheet.getByRole('link', { name: new RegExp(`^${label}`) })).toBeFocused();
    }
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('an entry of the sheet opens its page and closes the sheet', async ({ page, scenario }) => {
    await scenario('a-toi-menu-plus');

    await menu(page).getByRole('button', { name: 'Plus' }).click();
    await page.getByRole('dialog', { name: 'Plus' }).getByRole('link', { name: /^Planning/ }).click();
    await expect(page).toHaveURL(/\/planning$/);
    await expect(page.getByRole('dialog', { name: 'Plus' })).toBeHidden();
  });
});
