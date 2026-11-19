import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const editor = (page: Page) => page.locator('cd-page-process-editor');
const panel = (page: Page) => editor(page).getByRole('tabpanel');
const ticketsSelect = (page: Page) => panel(page).getByRole('combobox', { name: 'Source des Tickets' });
const codeSelect = (page: Page) => panel(page).getByRole('combobox', { name: 'Source du code et des documents' });
const banner = (page: Page) => editor(page).locator('cd-banner.migration').filter({ visible: true });
const dialog = (page: Page) => page.getByRole('alertdialog', { name: 'Passer les Tickets de Site mairie sur GitHub ?' });

/** US-102, US-26: moving the Tickets of a Projet to another Source, from its Sources, at 1280 px (the Selects are the PC's). */
test.describe('changing a Type d’artefact’s Source (US-102)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, 'the Selects: 1280 px');

  test('the Tickets’ Select opens the product’s dialog; « Annuler » changes nothing; « Migrer les Tickets » shows the migration live, without reloading', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('process-migration-source');
    await expect(panel(page)).toContainText('Changer de Source migre tout ce qu’elle tient. GitHub : octocat/site-mairie.');
    await expect(ticketsSelect(page)).toHaveValue('local');
    await expect(codeSelect(page)).toHaveValue('github');
    await page.evaluate(() => Object.assign(window, { __notReloaded: true }));

    await ticketsSelect(page).selectOption('github');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('Local → GitHub, octocat/site-mairie.');
    await expect(dialog(page)).toContainText('Aucun nouveau Ticket ne démarre pendant la migration ; les 2 Tickets en cours finissent sur Local.');
    await expect(dialog(page)).toContainText('Puis les 30 Tickets du dossier tickets/ deviennent 30 issues, d’un coup, avec leur état et leur historique.');
    await expect(dialog(page)).toContainText('Le dossier tickets/ est archivé, figé : plus rien ne s’y écrit.');
    await expect(dialog(page)).toContainText('Un Type d’artefact n’a jamais deux Sources, même un instant.');
    await expect(ticketsSelect(page)).toHaveValue('github');
    await expectAccessible(page);

    await dialog(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(ticketsSelect(page)).toHaveValue('local');
    await expect(banner(page)).toHaveCount(0);

    await ticketsSelect(page).selectOption('github');
    await dialog(page).getByRole('button', { name: 'Migrer les Tickets' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(banner(page)).toHaveJSProperty('data.title', 'Migration des Tickets vers GitHub');
    await expect(banner(page)).toContainText('Aucun nouveau Ticket ne démarre. #12 et #14 finissent sur Local, puis les 30 Tickets passent sur GitHub d’un coup.');
    await expect(panel(page)).toContainText('migration en cours · 2 Tickets à finir sur Local');
    await expect(panel(page).locator('cd-status-badge')).toHaveJSProperty('data.label', 'Local → GitHub');
    await expect(ticketsSelect(page)).toHaveCount(0);
    await expect(codeSelect(page)).toBeDisabled();
    expect(await page.evaluate(() => (window as { __notReloaded?: boolean }).__notReloaded)).toBe(true);
    await expectAccessible(page);
  });
});

/** A migration draining, read at both widths: its Banner, the Tickets’ badge and meta. */
test('a migration of Source in progress: its Banner, the Tickets’ badge and where it is, the other Select disabled', async ({ page, scenario, viewport, expectAccessible }) => {
  await scenario('process-migration-en-cours');

  await expect(banner(page)).toHaveJSProperty('data.title', 'Migration des Tickets vers GitHub');
  await expect(banner(page)).toContainText('Aucun nouveau Ticket ne démarre. #12 et #14 finissent sur Local, puis les 30 Tickets passent sur GitHub d’un coup.');
  const tickets = editor(page).locator('.item.caution').filter({ visible: true });
  await expect(tickets).toContainText('migration en cours · 2 Tickets à finir sur Local');
  await expect(tickets.locator('cd-status-badge')).toHaveJSProperty('data.label', 'Local → GitHub');
  if ((viewport?.width ?? 0) >= 1280) await expect(codeSelect(page)).toBeDisabled();
  await expectAccessible(page);
});
