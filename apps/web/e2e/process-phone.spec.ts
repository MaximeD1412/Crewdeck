import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const editor = (page: Page) => page.locator('cd-page-process-editor');
const header = (page: Page) => editor(page).locator('cd-page-header');
const banner = (page: Page) => editor(page).locator('cd-banner.phone-banner');
const group = (page: Page, phaseId: string) => editor(page).locator(`cd-phase-group[data-phase="${phaseId}"]`);
const stepRow = (page: Page, stepId: string) => editor(page).locator(`cd-step-row[data-step="${stepId}"]`);
const gapRows = (page: Page) => editor(page).locator('cd-card.phone-gaps cd-list-row');

/** US-98: « Gestion du process » read on the phone, below 1280 px (the editor is PROCESS-1's, at 1280). */
test.describe('« Gestion du process » on the phone (US-98)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1280, 'the phone: below 1280 px');

  test('the active version of « Process Crewdeck »: read only, « Aucun Manque », its Phases (the longest folded) and their Étapes, the Sources', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('process');

    await expect(editor(page).getByRole('heading', { level: 1, name: 'Gestion du process' })).toBeVisible();
    await expect(header(page)).toContainText('v3 active');
    await expect(header(page)).toContainText('Lecture seule sur le téléphone : la modification se fait sur PC.');
    await expect(editor(page).getByRole('button')).toHaveCount(0);
    await expect(editor(page).locator('cd-process-canvas')).toHaveCount(0);
    await expect(banner(page)).toContainText('Aucun Manque');
    await expect(banner(page)).toContainText('La v3 est active.');
    await expect(editor(page).locator('cd-card.phone-gaps')).toHaveCount(0);

    await expect(editor(page).locator('cd-phase-group')).toHaveCount(3);
    await expect(group(page, 'ph-idee').locator('details')).toHaveJSProperty('open', true);
    await expect(group(page, 'ph-conception').locator('details')).toHaveJSProperty('open', false);
    await expect(group(page, 'ph-conception').locator('summary')).toContainText('10 Étapes · 6 Retours');
    await expect(group(page, 'ph-dev').locator('details')).toHaveJSProperty('open', true);
    await expect(group(page, 'ph-dev').locator('summary')).toContainText('chaque Ticket prêt');
    await expect(stepRow(page, 'st-review')).toContainText('Review');
    await expect(stepRow(page, 'st-review')).toContainText('vers « Code », 3 fois au plus');
    await expect(stepRow(page, 'st-checks')).toContainText('GitHub');

    const sources = editor(page).locator('cd-card.phone-sources');
    await expect(sources).toContainText('Sources');
    await expect(sources.locator('cd-list-row').first()).toBeVisible();
    await expect(sources.locator('cd-status-badge').first()).toContainText('GitHub');
    await expectAccessible(page);
  });

  test('a draft and its five Manques: the Banner, the Manques first, their Phases open; a Manque chosen opens its Phase and brings its Étape into view', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('process-manques');

    await expect(banner(page)).toContainText('Brouillon non activable');
    await expect(banner(page)).toContainText('5 Manques à régler sur PC. La v3 reste active.');
    await expect(editor(page).locator('cd-card.phone-gaps')).toContainText('Manques');
    await expect(gapRows(page)).toHaveCount(5);
    await expect(gapRows(page).nth(1)).toContainText('Entrée « Verdict de la Review » de « Merge » : rien ne l’alimente');
    await expect(group(page, 'ph-idee').locator('details')).toHaveJSProperty('open', true);
    await expect(group(page, 'ph-dev').locator('details')).toHaveJSProperty('open', true);
    await expect(group(page, 'ph-dev').locator('summary')).toContainText('Manque');
    await expect(stepRow(page, 'st-e2e')).toContainText('Tests de bout en bout');
    await expect(editor(page).getByRole('button')).toHaveCount(0);
    await expectAccessible(page);

    await group(page, 'ph-dev').locator('summary').click();
    await expect(group(page, 'ph-dev').locator('details')).toHaveJSProperty('open', false);
    await gapRows(page).nth(4).locator('a').click();
    await expect(group(page, 'ph-dev').locator('details')).toHaveJSProperty('open', true);
    await expect(stepRow(page, 'st-e2e')).toBeInViewport();
    await expect(page).toHaveURL(/\/process$/);
  });

  test('a draft without a Manque reads as the draft, its changes counted', async ({ page, scenario }) => {
    await scenario('process-activation');

    await expect(banner(page)).toContainText('Brouillon : 3 changements');
    await expect(banner(page)).toContainText('Tu lis le brouillon ; la v3 reste active tant qu’il n’est pas activé sur PC.');
  });

  test('a Projet without an active version says so, the editor left to the PC', async ({ page, scenario }) => {
    await scenario('process-sans-version');

    await expect(banner(page)).toContainText('Pas encore de version active');
    await expect(editor(page).locator('cd-banner')).toHaveCount(1);
    await expect(editor(page).getByRole('button')).toHaveCount(0);
  });
});
