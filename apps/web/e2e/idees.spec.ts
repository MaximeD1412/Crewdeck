import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const ROWS = 'cd-page-idees cd-idea-row';
const rows = (page: Page) => page.locator(ROWS);
/** Each row's title, then its meta, in the order shown. */
const listed = (page: Page) =>
  page.locator(ROWS).evaluateAll((elements) =>
    elements.map((row) =>
      ['.open', '.meta'].map((part) => (row.shadowRoot?.querySelector(part) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
    ),
  );
const titles = async (page: Page) => (await listed(page)).map((row) => row.split(' | ')[0]);
const chip = (page: Page, name: string) => page.locator('cd-page-idees cd-project-filter').getByRole('button', { name: new RegExp(`^${name}`) });
const tab = (page: Page, name: string) => page.locator('cd-page-idees cd-tabs').getByRole('tab', { name: new RegExp(`^${name}`) });
const count = (page: Page) => page.locator('cd-page-idees cd-page-header').locator('.count');
/** The Dialog itself, and its fields from its host: Playwright's locators do not follow the slots of `cd-dialog`. */
const dialogBox = (page: Page) => page.getByRole('dialog', { name: 'Noter une Idée' });
const dialog = (page: Page) => page.locator('cd-note-idea-dialog');
const note = (page: Page) => page.locator('cd-page-idees cd-page-header').getByRole('button', { name: 'Noter une Idée' });

/** US-2, US-5: the Idées to triage, newest first, their texts opened by this Appareil only. */
test('« Idées » lists the Idées to triage newest first, in clear, the tabs and the chips counting them, accessible', async ({ page, scenario, expectAccessible }) => {
  await scenario('idees');
  await expect(count(page)).toHaveText('4 à trier');
  await expect(rows(page)).toHaveCount(4);
  await expect.poll(() => titles(page)).toEqual([
    'Prévenir quand une Planification démarre la Boucle',
    'Exporter le planning en PDF pour le client',
    'Corriger la date des actualités sur le téléphone',
    'Chercher dans les recettes par ingrédient',
  ]);
  const [first, second, third, fourth] = await listed(page);
  expect(first).toMatch(/\| #64 · Crewdeck · il y a 5 min$/);
  expect(second).toMatch(/\| #63 · Personal OS · il y a 2 h$/);
  expect(third).toMatch(/\| #62 · Site mairie · /);
  expect(fourth).toMatch(/\| #61 · Personal OS · /);
  await expect(page.locator('#app > cd-cadre > cd-menu-item').nth(1)).toContainText('4');
  await expectAccessible(page);

  // The tabs count the Idées of the Projet chosen; the chips, those of the tab.
  await expect(tab(page, 'À trier')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'À trier')).toContainText('4');
  await expect(tab(page, 'Retenues')).toContainText('2');
  await expect(tab(page, 'Fusionnées')).toContainText('1');
  await expect(tab(page, 'Rejetées')).toContainText('1');
  await expect(chip(page, 'Tous les Projets')).toContainText('4');
  await expect(chip(page, 'Personal OS')).toContainText('2');

  await chip(page, 'Personal OS').click();
  await expect(page).toHaveURL(/\/idees\?projet=[0-9a-f-]{36}$/);
  await expect.poll(() => titles(page)).toEqual(['Exporter le planning en PDF pour le client', 'Chercher dans les recettes par ingrédient']);
  await expect(chip(page, 'Personal OS')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab(page, 'Retenues')).toContainText('1');
  await expect(count(page)).toHaveText('4 à trier');

  await tab(page, 'Retenues').click();
  await expect(page).toHaveURL(/\/idees\?(?=.*projet=)(?=.*onglet=retenues)/);
  await expect.poll(() => titles(page)).toEqual(['Imprimer le planning de la semaine']);
  await chip(page, 'Tous les Projets').click();
  await expect.poll(() => titles(page)).toEqual(['Classer les joueurs par niveau', 'Imprimer le planning de la semaine']);
  await expectAccessible(page);
});

/** US-1: noted from the page, sealed by it, at the top of « À trier » here and on another tab, the Décision counting it. */
test('« Noter une Idée » seals it in the page: #65 at the top of « À trier » within 2 s, on this tab and on another, accessible', async ({
  page,
  context,
  scenario,
  expectAccessible,
}) => {
  await scenario('idees');
  await expect(rows(page)).toHaveCount(4);
  const other = await context.newPage();
  await other.goto('/idees');
  await expect.poll(() => titles(other)).toContain('Prévenir quand une Planification démarre la Boucle');

  let reloads = 0;
  page.on('load', () => (reloads += 1));
  await note(page).click();
  await expect(dialogBox(page)).toBeVisible();
  await expectAccessible(page);
  await dialog(page).getByRole('textbox', { name: 'Ton Idée, en une phrase' }).fill('Pouvoir dupliquer une recette');
  await dialog(page).getByRole('combobox', { name: 'Projet' }).selectOption({ label: 'Personal OS' });

  const sent = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/ideas');
  await dialog(page).getByRole('button', { name: 'Noter', exact: true }).click();
  // Only ciphertext leaves the page.
  expect((await sent).postData()).not.toContain('dupliquer');

  await expect(dialogBox(page)).toBeHidden();
  for (const tabPage of [page, other]) {
    await expect.poll(async () => (await listed(tabPage))[0], { timeout: 2_000 }).toBe('Pouvoir dupliquer une recette | #65 · Personal OS · à l\'instant');
    await expect(count(tabPage)).toHaveText('5 à trier');
  }
  expect(reloads).toBe(0);

  // « À toi »'s Décision counts it.
  await page.goto('/a-toi');
  await expect(page.locator('cd-page-a-toi cd-decision-row').filter({ hasText: '5 Idées à trier' })).toHaveCount(1);
});

test('without an Idée, « Aucune Idée pour l’instant » and its « Noter une Idée » opens the Dialog, accessible', async ({ page, scenario, expectAccessible }) => {
  await scenario('idees-vide');
  await expect(page.locator('cd-page-idees cd-empty')).toContainText('Aucune Idée pour l’instant');
  await expect(count(page)).toHaveText('0');
  await expectAccessible(page);
  await page.locator('cd-page-idees cd-empty').getByRole('button', { name: 'Noter une Idée' }).click();
  await expect(dialogBox(page)).toBeVisible();
  await expect(dialog(page).getByRole('textbox', { name: 'Ton Idée, en une phrase' })).toBeVisible();
  await expect(dialog(page).getByRole('combobox', { name: 'Projet' })).toHaveValue('');
});

/** E2E-2: an Appareil not approved holds no vault key; it cannot seal an Idée. */
test('on an Appareil not approved, the Dialog says to approve it, with a link to « Paramètres », accessible', async ({ page, scenario, expectAccessible }) => {
  await scenario('idees', { device: false });
  await expect(rows(page)).toHaveCount(4);
  await note(page).click();
  await expect(dialogBox(page)).toBeVisible();
  await expect(dialog(page)).toContainText('Approuve cet Appareil pour noter une Idée');
  await expect(dialog(page).getByRole('textbox')).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Noter', exact: true })).toHaveCount(0);
  await expectAccessible(page);
  await dialog(page).getByRole('link', { name: 'Aller aux Paramètres' }).click();
  await expect(page).toHaveURL(/\/parametres$/);
});
