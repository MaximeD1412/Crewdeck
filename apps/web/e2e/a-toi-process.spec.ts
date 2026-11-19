import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const ROWS = 'cd-page-a-toi cd-decision-row';
const exhaustedRow = (page: Page) => page.locator(ROWS).filter({ hasText: 'a demandé des changements' });
/** A part of the row, read through its shadow root. */
const part = (page: Page, selector: string) =>
  exhaustedRow(page).evaluate((row, selector) => (row.shadowRoot?.querySelector(selector) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim(), selector);
/** The Décision opened in place, narrower than 1280 px. */
const OPENED = 'cd-page-a-toi cd-dialog.opened';
const count = (page: Page) => page.locator('cd-page-a-toi cd-page-header').locator('.count');

/**
 * Presses a button of the row: beside it from 1280 px; narrower, where the
 * row hides them, in the Décision a tap on the row opens in place.
 */
const answer = async (page: Page, width: number, name: string) => {
  if (width >= 1280) return exhaustedRow(page).getByRole('button', { name }).click();
  await exhaustedRow(page).locator('.open').click();
  await expect(page.getByRole('dialog', { name: '#57 Recherche d’actes' })).toBeVisible();
  // Its body and buttons, in the Emplacements of the `cd-dialog`.
  const opened = page.locator(OPENED);
  await expect(opened).toContainText('Review a demandé des changements 4 fois, le maximum de son Retour vers « Code » : le Ticket s’est arrêté.');
  await expect(opened.getByRole('button', { name: /Encore un passage|Arrêter/ })).toHaveText(['Encore un passage', 'Arrêter']);
  await opened.getByRole('button', { name }).click();
  await expect(opened).toHaveCount(0);
};

/** #57's PhaseRun, as `GET /api/state` gives it. */
const phaseRunOf57 = async (page: Page) => {
  const state = (await (await page.request.get('/api/state')).json()) as { phaseRuns: { itemId: string; state: string; waitingOn: string | null }[] };
  return state.phaseRuns.find((phaseRun) => phaseRun.itemId === '57');
};

/** PROCESS-6, risk AGT-9: a Retour taken up to its maximum stops the work on « Maximum de Retours atteint ». */
test.describe('« Maximum de Retours atteint » (PROCESS-6)', () => {
  test('the row: its icon, kind, item, context and buttons, among the nine others, accessible', async ({ page, scenario, expectAccessible, capture }) => {
    await scenario('a-toi-process');

    await expect(page.locator(ROWS)).toHaveCount(10);
    await expect(count(page)).toHaveText('10 Décisions');
    await expect(exhaustedRow(page)).toHaveCount(1);
    expect(await part(page, '.open')).toBe('Maximum de Retours atteint · #57 Recherche d’actes');
    expect(await part(page, '.meta')).toBe('Site mairie · Review · il y a 25 min');
    await expect(exhaustedRow(page)).toContainText('Review a demandé des changements 4 fois, le maximum de son Retour vers « Code » : le Ticket s’est arrêté.');
    expect(
      await exhaustedRow(page).evaluate((row) => ({
        tone: row.shadowRoot?.querySelector('.row')?.classList.contains('caution'),
        icon: (row.shadowRoot?.querySelector('.icon cd-icon') as (Element & { data?: { name: string } }) | null)?.data?.name,
      })),
    ).toEqual({ tone: true, icon: 'undo' });
    // Its buttons, shown beside it from 1280 px (narrower, in the Décision a tap on the row opens).
    await expect(exhaustedRow(page).locator('[slot=actions]')).toHaveText(['Encore un passage', 'Arrêter']);
    await expectAccessible(page);
    await capture(page, 'a-toi-process');
  });

  test('narrower than 1280 px, a tap on the row opens it in place, accessible; Escape closes it unanswered', async ({ page, scenario, viewport, expectAccessible }) => {
    test.skip((viewport?.width ?? 0) >= 1280, 'from 1280 px the row shows its buttons');
    await scenario('a-toi-process');

    await exhaustedRow(page).locator('.open').click();
    await expect(page.getByRole('dialog', { name: '#57 Recherche d’actes' })).toBeVisible();
    const opened = page.locator(OPENED);
    await expect(page).toHaveURL(/\/a-toi$/);
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(opened).toHaveCount(0);
    expect(await phaseRunOf57(page)).toMatchObject({ state: 'waiting', waitingOn: 'decision' });
    await expect(exhaustedRow(page)).toHaveCount(1);
  });

  test('« Encore un passage »: the row goes, the Retour to « Code » taken once more', async ({ page, scenario, viewport }) => {
    await scenario('a-toi-process');
    expect(await phaseRunOf57(page)).toMatchObject({ state: 'waiting', waitingOn: 'decision' });

    const answered = page.waitForResponse((response) => response.url().endsWith('/one-more-pass'));
    await answer(page, viewport?.width ?? 0, 'Encore un passage');
    // The Retour taken a 4th time, one pass beyond its maximum; the PhaseRun no longer waits on the Décision. (`pnpm dev` has no handler of « Code » before BOUCLE-2: its 5th iteration then fails, `no-handler`.)
    expect(await (await answered).json()).toMatchObject({ itemId: '57', waitingOn: null, loopBacks: [{ from: 'st-review', to: 'st-code', taken: 4, extra: 1 }] });
    await expect(exhaustedRow(page)).toHaveCount(0);
    await expect(count(page)).toHaveText('9 Décisions');
  });

  test('« Arrêter »: the row goes, the work stops', async ({ page, scenario, viewport }) => {
    await scenario('a-toi-process');

    const answered = page.waitForResponse((response) => response.url().endsWith('/stop'));
    await answer(page, viewport?.width ?? 0, 'Arrêter');
    expect(await (await answered).json()).toMatchObject({ itemId: '57', state: 'stopped', waitingOn: null });
    await expect(exhaustedRow(page)).toHaveCount(0);
    // A stopped PhaseRun has left the state.
    expect(await phaseRunOf57(page)).toBeUndefined();
  });
});
