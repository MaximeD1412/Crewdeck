import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const editor = (page: Page) => page.locator('cd-page-process-editor');
const header = (page: Page) => editor(page).locator('cd-page-header');
const activate = (page: Page, name: string) => header(page).getByRole('button', { name });
const dialog = (page: Page) => page.getByRole('alertdialog', { name: 'Activer la v4 du Process de Site mairie ?' });

/** PROCESS-10: a draft of three changes on v3 activated as v4, the work in progress staying on its version (1280 px, as the editor). */
test.describe('activating a draft (US-96, US-97)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, 'the editor: 1280 px');

  test('« Activer la v4 »: the three changes and the work by version confirmed; v4 active, « Aucun changement depuis la v4. », « Version 4 active. »', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('process-activation');
    await expect(header(page)).toContainText('brouillon · 3 changements');
    await expect(editor(page).locator('footer.foot')).toContainText(
      '3 changements depuis la v3 : Serveur MCP « Stitch » attaché à « Maquettes » ; Serveur MCP « Figma » attaché à « Maquettes » ; Retour de « Review » vers « Code » : 5 fois au plus, au lieu de 3.',
    );
    await expect(editor(page).locator('footer.foot')).toContainText('2 Tickets en cours finissent sur la v3 · 1 Conception en cours finit sur la v2');
    await expectAccessible(page);

    await activate(page, 'Activer la v4').click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('3 changements depuis la v3 :');
    await expect(dialog(page).getByRole('listitem')).toHaveText([
      'Serveur MCP « Stitch » attaché à « Maquettes » ;',
      'Serveur MCP « Figma » attaché à « Maquettes » ;',
      'Retour de « Review » vers « Code » : 5 fois au plus, au lieu de 3.',
    ]);
    await expect(dialog(page)).toContainText(
      'Le travail qui démarre ensuite suit la v4. Ce qui est en cours finit sur la version où il a démarré : les Tickets #53 et #57 sur la v3, la Conception « Actualités » sur la v2.',
    );
    await expectAccessible(page);

    await dialog(page).getByRole('button', { name: 'Activer la v4' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(header(page)).toContainText('v4 active');
    await expect(editor(page).locator('footer.foot')).toContainText('Aucun changement depuis la v4.');
    await expect(editor(page).locator('cd-toast')).toContainText('Version 4 active.');
    await expect(activate(page, 'Activer la v5')).toBeDisabled();
  });

  test('« Annuler » writes nothing: the draft stays, still to activate', async ({ page, scenario }) => {
    const run = await scenario('process-activation');
    const projectId = /\/projets\/([^/]+)\/process/.exec(run.path)?.[1] ?? '';

    await activate(page, 'Activer la v4').click();
    await dialog(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog(page)).toHaveCount(0);

    const read = await page.request.get(`/api/projects/${projectId}/process`);
    const view = (await read.json()) as { active: { number: number }; draft: { revision: number } | null };
    expect(view.active.number).toBe(3);
    expect(view.draft).not.toBeNull();
    await expect(header(page)).toContainText('brouillon · 3 changements');
    await expect(activate(page, 'Activer la v4')).toBeEnabled();
  });

  test('another tab activates the draft: this one shows v4 without a reload', async ({ page, scenario }) => {
    const run = await scenario('process-activation');
    await expect(header(page)).toContainText('brouillon · 3 changements');

    const other = await page.context().newPage();
    await other.goto(run.path);
    await activate(other, 'Activer la v4').click();
    await dialog(other).getByRole('button', { name: 'Activer la v4' }).click();
    await expect(header(other)).toContainText('v4 active');
    await other.close();

    await expect(header(page)).toContainText('v4 active', { timeout: 2_000 });
    await expect(editor(page).locator('footer.foot')).toContainText('Aucun changement depuis la v4.');
  });
});
