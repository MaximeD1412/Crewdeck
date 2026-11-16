import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Paramètres / Sections' });
const zone = (page: Page) => page.getByRole('combobox', { name: 'Zone IANA' });
const library = (page: Page) => page.getByRole('link', { name: /Bibliothèque de Composants/ });

/**
 * US-82, US-18: the Paramètres of the account show only the sections that
 * have content, « Compte » with the time zone and « Pour les Moddeurs »; on
 * the phone one at a time, the one its link opens, at 1280 px both. A time
 * zone picked is saved, and another tab of the Pilote shows it at once.
 */
test('the Paramètres: the sections with content only, the time zone saved and shown live in another tab, the library a link away', async ({
  page,
  scenario,
  expectAccessible,
  viewport,
}) => {
  await scenario('parametres');
  await expect(page.getByRole('heading', { level: 1, name: 'Paramètres' })).toBeVisible();
  await expect(nav(page).getByRole('link')).toHaveText(['Compte', 'Pour les Moddeurs']);
  await expect(zone(page)).toHaveValue('Europe/Paris');
  await expectAccessible(page);

  if ((viewport?.width ?? 0) >= 1280) {
    await expect(library(page)).toBeVisible();
  } else {
    await expect(library(page)).toBeHidden();
    await nav(page).getByRole('link', { name: 'Pour les Moddeurs' }).click();
    await expect(library(page)).toBeVisible();
    await expect(zone(page)).toBeHidden();
    await expect(page).toHaveURL('/parametres');
    await nav(page).getByRole('link', { name: 'Compte' }).click();
  }

  const other = await page.context().newPage();
  await other.goto('/parametres');
  await expect(zone(other)).toHaveValue('Europe/Paris');

  await zone(page).selectOption('Asia/Tokyo');
  await expect(zone(other)).toHaveValue('Asia/Tokyo');
  const me = await page.request.get('/api/me');
  expect(await me.json()).toMatchObject({ timeZone: 'Asia/Tokyo' });
  await other.reload();
  await expect(zone(other)).toHaveValue('Asia/Tokyo');
  await other.close();

  if ((viewport?.width ?? 0) < 1280) await nav(page).getByRole('link', { name: 'Pour les Moddeurs' }).click();
  await library(page).click();
  await expect(page).toHaveURL('/parametres/composants');
  await expect(page.locator('cd-page-composants')).toBeVisible();
});
