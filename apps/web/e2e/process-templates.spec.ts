import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const editor = (page: Page) => page.locator('cd-page-process-editor');
const open = (page: Page) => editor(page).locator('cd-page-header').getByRole('button', { name: 'Enregistrer comme Modèle de process' });
/** A Dialog's host: its role is in its shadow, its fields and buttons are slotted. */
const saveDialog = (page: Page) => editor(page).locator('cd-dialog.save-template-dialog');
const templateName = (page: Page) => saveDialog(page).getByRole('textbox', { name: 'Nom du Modèle de process' });
const card = (page: Page) => page.locator('cd-process-template-list');
const rows = (page: Page) => card(page).locator('cd-list-row');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Paramètres / Sections' });
const desktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280;

/** On the phone the Paramètres show one section at a time: opens « Modèles de process »; at 1280 px they all show. */
const showTemplates = async (page: Page) => {
  if (!desktop(page)) await nav(page).getByRole('link', { name: 'Modèles de process' }).click();
  await expect(card(page)).toBeVisible();
};

/**
 * PROCESS-14, US-97: « Enregistrer comme Modèle de process » from the
 * Gestion du process (1280 px, as its header's actions) saves the active v3,
 * and the Modèle shows at once in the Paramètres of another tab; the same
 * name again is refused first, then replaces it once asked.
 */
test.describe('saving a Projet’s Process as a Modèle (US-97)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, 'the editor’s header: 1280 px');

  test('« Process Site mairie » saved from the v3 active, shown live in the Paramètres; the same name again replaces it once asked', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('process-enregistrer-modele');
    const other = await page.context().newPage();
    await other.goto('/parametres');
    await expect(card(other)).toBeVisible();
    await expect(card(other)).toContainText('Aucun Modèle de process');

    await open(page).click();
    await expect(saveDialog(page).getByRole('dialog', { name: 'Enregistrer comme Modèle de process' })).toBeVisible();
    await expect(templateName(page)).toHaveValue('Process Site mairie');
    await expect(saveDialog(page)).toContainText(
      'Il copie la v3 active : ses Phases, leurs Étapes, leurs Outils et leurs Retours. Tes prochains Projets pourront partir de lui ; Site mairie garde son Process.',
    );
    await expectAccessible(page);

    await saveDialog(page).getByRole('button', { name: 'Enregistrer le Modèle de process' }).click();
    await expect(saveDialog(page).getByRole('dialog')).toBeHidden();
    await expect(editor(page).locator('cd-toast')).toContainText('Modèle de process « Process Site mairie » enregistré.');
    await expect(rows(other)).toHaveCount(1);
    await expect(rows(other).first()).toContainText('Process Site mairie');
    await expect(rows(other).first()).toContainText(/depuis Site mairie · \d+ \S+/);

    await open(page).click();
    await saveDialog(page).getByRole('button', { name: 'Enregistrer le Modèle de process' }).click();
    await expect(saveDialog(page)).toContainText('Un Modèle de process porte déjà ce nom.');
    await saveDialog(page).getByRole('button', { name: 'Remplacer « Process Site mairie »' }).click();
    await expect(saveDialog(page).getByRole('dialog')).toBeHidden();
    await expect(rows(other)).toHaveCount(1);
    await other.close();
  });
});

/**
 * PROCESS-14, US-111: the Paramètres list the Modèles, newest first, each
 * with the Projet it was saved from and its date; a rename refused on a name
 * taken says it under the name; a rename and a removal show at once in
 * another tab.
 */
test('« Modèles de process »: listed newest first, renamed and removed, shown live in another tab; a name taken refused', async ({ page, scenario, expectAccessible }) => {
  await scenario('parametres');
  await showTemplates(page);
  await expect(card(page).getByRole('heading', { name: 'Modèles de process' })).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toContainText('Process Site mairie');
  await expect(rows(page).nth(0)).toContainText('depuis Site mairie · 12 nov.');
  await expect(rows(page).nth(1)).toContainText('Process atelier');
  await expect(rows(page).nth(1)).toContainText('depuis un Projet supprimé · 3 nov.');
  await expectAccessible(page);

  const other = await page.context().newPage();
  await other.goto('/parametres');
  await showTemplates(other);

  const atelier = rows(page).nth(1);
  await atelier.getByRole('button', { name: 'Renommer' }).click();
  const renaming = page.locator('cd-process-template-list cd-dialog.renaming');
  const field = renaming.getByRole('textbox', { name: 'Nom du Modèle de process' });
  await expect(field).toHaveValue('Process atelier');
  await field.fill('process site MAIRIE');
  await expect(renaming.getByRole('dialog', { name: 'Renommer le Modèle de process' })).toBeVisible();
  await renaming.getByRole('button', { name: 'Renommer' }).click();
  await expect(renaming).toContainText('Un Modèle de process porte déjà ce nom.');
  await expectAccessible(page);
  await field.fill('Process atelier court');
  await field.press('Enter');
  await expect(renaming.getByRole('dialog')).toBeHidden();
  await expect(rows(other).filter({ hasText: 'Process atelier court' })).toHaveCount(1);

  await rows(page).filter({ hasText: 'Process Site mairie' }).getByRole('button', { name: 'Supprimer' }).click();
  const removing = page.locator('cd-process-template-list cd-dialog.removing');
  await expect(removing.getByRole('dialog', { name: 'Supprimer le Modèle de process « Process Site mairie » ?' })).toBeVisible();
  await expect(removing).toContainText('Les Projets partis de lui gardent leur Process.');
  await removing.getByRole('button', { name: 'Supprimer' }).click();
  await expect(removing.getByRole('dialog')).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(other)).toHaveCount(1);
  await expect(rows(other)).toContainText('Process atelier court');
  await other.close();
});
