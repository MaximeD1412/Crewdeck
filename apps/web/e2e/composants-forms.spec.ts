import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/** The library opened on `name`, through the `composants` scenario (nothing seeded). */
const open = async (page: Page, scenario: (name: string) => Promise<unknown>, name: string) => {
  await scenario('composants');
  await page.goto(`/parametres/composants?c=${name}`);
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^${name}`) })).toBeVisible();
};

/** The focused element's text, through the shadow roots. */
const focusedText = (page: Page) =>
  page.evaluate(() => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  });

const isPhone = () => test.info().project.name === 'phone';

test.describe('the form Composants and the Dialog in the library (UI-4)', () => {
  test('TextField: its examples, typed into from the keyboard, the error said under the field, accessible', async ({ page, scenario, expectAccessible }) => {
    await open(page, scenario, 'TextField');

    const idea = page.getByRole('textbox', { name: 'Ton idée' });
    await idea.focus();
    await page.keyboard.type('Page Planning');
    await expect(idea).toHaveValue('Page Planning');

    const time = page.getByRole('textbox', { name: 'Heure' });
    await expect(time).toHaveAttribute('aria-invalid', 'true');
    await expect(time).toHaveAccessibleDescription(/Une heure entre 00:00 et 23:59\./);

    const comment = page.getByRole('textbox', { name: 'Ce qu’il faut changer' });
    await comment.focus();
    await page.keyboard.type('Une ligne');
    await page.keyboard.press('Enter');
    await page.keyboard.type('puis une autre');
    await expect(comment).toHaveValue('Une ligne\npuis une autre');

    await expect(page.getByRole('textbox', { name: 'Dépôt GitHub' })).toBeDisabled();
    await expectAccessible(page);
  });

  test('SettingRow: where each value comes from, its controls used from the keyboard, accessible', async ({ page, scenario, expectAccessible }) => {
    await open(page, scenario, 'SettingRow');

    const preview = page.locator('cd-setting-row');
    await expect(preview).toHaveCount(3);
    await expect(preview.nth(0)).toContainText('Hérité du compte');
    await expect(preview.nth(1)).toContainText('Modifié pour ce Projet');
    await expect(preview.nth(2)).not.toContainText(/Hérité du compte|Modifié pour ce Projet/);

    const toggle = page.getByRole('switch', { name: 'Activée' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    const name = page.getByRole('textbox', { name: 'Nom' });
    await name.focus();
    await page.keyboard.press('End');
    await page.keyboard.type(' 2');
    await expect(name).toHaveValue('Crewdeck 2');

    await expectAccessible(page);
  });

  test('Select, Toggle, Checkbox and Radio: each used from the keyboard', async ({ page, scenario }) => {
    await open(page, scenario, 'Select');
    const engine = page.getByRole('combobox', { name: 'Moteur du Rôle Code' });
    await expect(engine).toHaveValue('claude-code');
    await expect(engine.getByRole('option', { name: /Gemini CLI/ })).toBeDisabled();
    await engine.focus();
    await page.keyboard.press('ArrowDown');
    await expect(engine).toHaveValue('codex');
    await expect(page.getByRole('combobox', { name: 'Runner' })).toBeDisabled();

    await open(page, scenario, 'Toggle');
    const notifications = page.getByRole('switch', { name: 'Notifications sur le téléphone' });
    await notifications.focus();
    await page.keyboard.press('Space');
    await expect(notifications).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Space');
    await expect(notifications).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'Revue croisée' })).toBeDisabled();

    await open(page, scenario, 'Checkbox');
    const site = page.getByRole('checkbox', { name: 'Site mairie' });
    await site.focus();
    await page.keyboard.press('Space');
    await expect(site).toBeChecked();

    await open(page, scenario, 'Radio');
    const nightly = page.getByRole('radio', { name: 'Chaque nuit' });
    await nightly.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'À une heure' })).toBeChecked();
    await expect(nightly).not.toBeChecked();
    expect(await focusedText(page)).toBe('');
    await expect(page.getByRole('radio', { name: 'À une heure' })).toBeFocused();
  });

  test('Dialog: opened from its button, the focus inside; Escape and « Fermer » close it, the focus back on the button', async ({ page, scenario, expectAccessible, capture }) => {
    await open(page, scenario, 'Dialog');

    const opener = page.getByRole('button', { name: 'Ouvrir « noter une Idée »' });
    const dialog = page.getByRole('dialog', { name: 'Noter une Idée' });
    await expect(dialog).toBeHidden();
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Fermer' })).toBeFocused();
    // Its body and its buttons are slotted: in the page's tree, under the cd-dialog host, not under the <dialog>.
    await expect(page.getByRole('textbox', { name: 'Ton idée' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Noter', exact: true })).toBeVisible();
    const box = await dialog.boundingBox();
    if (isPhone()) expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
    else expect(box?.width).toBeLessThan(1280);
    await expectAccessible(page);
    await capture(page, 'composants-dialog-open');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expectAccessible(page);
  });

  test('the library: searched by name at 1280 px, picked through the Select on the phone, accessible', async ({ page, scenario, expectAccessible }) => {
    await scenario('composants');
    const catalogue = page.getByRole('navigation', { name: 'Catalogue des Composants' });

    if (isPhone()) {
      await expect(page.getByRole('textbox', { name: 'Chercher un Composant' })).toBeHidden();
      await expect(catalogue).toBeHidden();
      await page.getByRole('combobox', { name: 'Composant', exact: true }).selectOption({ label: 'SettingRow · Parties de page' });
      await expect(page).toHaveURL(/\?c=SettingRow$/);
      await expect(page.locator('cd-setting-row')).toHaveCount(3);
    } else {
      await expect(page.getByRole('combobox', { name: 'Composant', exact: true })).toBeHidden();
      const search = page.getByRole('textbox', { name: 'Chercher un Composant' });
      await search.fill('DIALÔG');
      await expect(catalogue.getByRole('link')).toHaveText(['Dialog']);
      await expect(catalogue.getByRole('heading', { level: 2 })).toHaveText([/^Parties de page/]);
      await search.fill('zzz');
      await expect(catalogue).toContainText('Aucun Composant ne porte ce nom.');
      await search.fill('');
      await expect(catalogue.getByRole('link', { name: /^Toggle$/ })).toBeVisible();
    }
    await expectAccessible(page);
  });
});
