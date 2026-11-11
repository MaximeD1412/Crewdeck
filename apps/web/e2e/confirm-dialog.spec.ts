import type { Page } from '@playwright/test';
import { APPROVE_PRD, openConfirm } from './confirm.js';
import { expect, test } from './fixtures.js';

/**
 * CORE-7: the core's `crewdeck-confirm`, opened through the development
 * harness as an Action sensible opens it, with a three-part consequence. At
 * 390 px it fills the screen, at 1280 px it is centred over the page.
 */

const answer = (page: Page) => page.evaluate(() => window.__answer);
const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? null);

test('the confirmation of an Action sensible: the mark, the consequences, « Annuler » focused, accessible, the focus back on close', async ({
  page,
  scenario,
  expectAccessible,
  capture,
  viewport,
}) => {
  await scenario('composants');
  await openConfirm(page);
  const dialog = page.getByRole('alertdialog', { name: APPROVE_PRD.title });

  await expect(dialog.getByText('Confirmé par Crewdeck · Action sensible')).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveText([
    'merger la PR #14 du PRD dans develop ;',
    'démarrer l’Étape Maquettes avec le Moteur du Rôle Conception (Claude Code).',
  ]);
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  const box = await dialog.boundingBox();
  if (viewport && viewport.width < 1280) {
    expect(box).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  } else {
    expect(box?.width).toBeLessThan((viewport?.width ?? 0) / 2);
  }
  await expectAccessible(page);
  await capture(page, 'confirm-dialog', { fullPage: false });

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await answer(page)).toBe(false);
  expect(await focusedId(page)).toBe('opener');

  await openConfirm(page);
  await page.getByRole('button', { name: 'Approuver le PRD' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await answer(page)).toBe(true);
  expect(await focusedId(page)).toBe('opener');
});
