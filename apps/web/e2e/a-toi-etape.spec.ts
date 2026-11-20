import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const ROWS = 'cd-page-a-toi cd-decision-row';
/** A row, by its context (`a-toi` has another « Contrat incomplet », a Conception's). */
const rowOf = (page: Page, row: Row) => page.locator(ROWS).filter({ hasText: row.context });
/** A part of the row, read through its shadow root. */
const part = (page: Page, row: Row, selector: string) =>
  rowOf(page, row).evaluate((row, selector) => (row.shadowRoot?.querySelector(selector) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim(), selector);
/** The Décision opened in place, narrower than 1280 px. */
const OPENED = 'cd-page-a-toi cd-dialog.opened';
const count = (page: Page) => page.locator('cd-page-a-toi cd-page-header').locator('.count');

const INCOMPLETE = { kind: 'Contrat incomplet', title: 'Code', context: 'Règle « code.tests » et 1 autre', meta: 'Site mairie · Développement · il y a 25 min', icon: 'contract' } as const;
const FAILED = { kind: 'Étape échouée', title: 'Review', context: 'La session s’est arrêtée en erreur.', meta: 'Site mairie · Développement · il y a 30 min', icon: 'alert' } as const;
type Row = typeof INCOMPLETE | typeof FAILED;

/**
 * Presses a button of the row: beside it from 1280 px; narrower, where the
 * row hides them, in the Décision a tap on the row opens in place.
 */
const press = async (page: Page, width: number, row: Row, name: string) => {
  if (width >= 1280) return rowOf(page, row).getByRole('button', { name }).click();
  await rowOf(page, row).locator('.open').click();
  await expect(page.getByRole('dialog', { name: row.title })).toBeVisible();
  const opened = page.locator(OPENED);
  await expect(opened).toContainText(row.context);
  await expect(opened.getByRole('button', { name: /Relancer l’Étape|Voir/ })).toHaveText(['Relancer l’Étape', 'Voir']);
  await opened.getByRole('button', { name }).click();
  await expect(opened).toHaveCount(0);
};

/** ATOI-2, US-48, risk IA-6: an Étape whose Contrat is incomplete, or whose Session failed, waits for the Pilote in « À toi ». */
test.describe('« Contrat incomplet » and « Étape échouée » (ATOI-2)', () => {
  test('the rows: their icon, kind, Étape, Phase, context and buttons, among the nine others, accessible', async ({ page, scenario, expectAccessible }) => {
    await scenario('a-toi-etape');

    await expect(page.locator(ROWS)).toHaveCount(11);
    await expect(count(page)).toHaveText('11 Décisions');
    for (const row of [INCOMPLETE, FAILED]) {
      await expect(rowOf(page, row)).toHaveCount(1);
      expect(await part(page, row, '.open')).toBe(`${row.kind} · ${row.title}`);
      expect(await part(page, row, '.meta')).toBe(row.meta);
      await expect(rowOf(page, row)).toContainText(row.context);
      expect(
        await rowOf(page, row).evaluate((element) => ({
          tone: element.shadowRoot?.querySelector('.row')?.classList.contains('caution'),
          icon: (element.shadowRoot?.querySelector('.icon cd-icon') as (Element & { data?: { name: string } }) | null)?.data?.name,
        })),
      ).toEqual({ tone: true, icon: row.icon });
      await expect(rowOf(page, row).locator('[slot=actions]')).toHaveText(['Relancer l’Étape', 'Voir']);
    }
    await expectAccessible(page);
  });

  for (const row of [INCOMPLETE, FAILED]) {
    test(`« Relancer l’Étape » on « ${row.kind} »: a new pass of the Étape, the row gone without a reload`, async ({ page, scenario, viewport }) => {
      await scenario('a-toi-etape');
      await expect(page.locator(ROWS)).toHaveCount(11);
      const loads: string[] = [];
      page.on('load', () => loads.push(page.url()));

      const answered = page.waitForResponse((response) => response.url().endsWith('/rerun'));
      await press(page, viewport?.width ?? 0, row, 'Relancer l’Étape');
      const response = await answered;
      expect(response.status()).toBe(200);
      const failedId = /\/api\/step-runs\/([^/]+)\/rerun$/.exec(response.url())?.[1];
      // A new StepRun of the same Étape and iteration. (`pnpm dev` has no handler of an agent Étape before BOUCLE-2: it then fails, `no-handler`.)
      const { stepRun } = (await response.json()) as { stepRun: { id: string; stepId: string; iteration: number } | null };
      expect(stepRun).toMatchObject({ stepId: row === INCOMPLETE ? 'st-code' : 'st-review', iteration: 1 });
      expect(stepRun?.id).not.toBe(failedId);

      await expect(rowOf(page, row)).toHaveCount(0);
      await expect(count(page)).toHaveText('10 Décisions');
      await expect(rowOf(page, row === INCOMPLETE ? FAILED : INCOMPLETE)).toHaveCount(1);
      expect(loads).toEqual([]);
    });
  }

  test('« Voir » opens the Décision’s page', async ({ page, scenario, viewport }) => {
    await scenario('a-toi-etape');

    await press(page, viewport?.width ?? 0, INCOMPLETE, 'Voir');
    await expect(page).toHaveURL(/\/projets\/019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03$/);
  });
});
