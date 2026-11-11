/**
 * The captures of a visual review, written by `scripts/captures.sh`:
 * `CAPTURES_SCENARIOS` (comma-separated scenario names, the ids of
 * `design/screens.json`) into `CAPTURES_DIR`, once per project (390 and 1280 px).
 */
import type { Page } from '@playwright/test';
import { test } from './fixtures.js';

/** What a scenario's capture shows beyond its page: a sheet or a dialog opened, by width. */
const PREPARE: Readonly<Record<string, (page: Page, width: number) => Promise<void>>> = {
  'a-toi-menu-plus': async (page, width) => {
    if (width < 1280) await page.getByRole('button', { name: 'Plus' }).click();
  },
};

const names = (process.env['CAPTURES_SCENARIOS'] ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

test.skip(names.length === 0 || !process.env['CAPTURES_DIR'], 'CAPTURES_SCENARIOS et CAPTURES_DIR : à lancer par scripts/captures.sh');

for (const name of names) {
  test(`capture ${name}`, async ({ page, scenario, capture }) => {
    await scenario(name);
    await page.waitForLoadState('networkidle');
    await PREPARE[name]?.(page, page.viewportSize()?.width ?? 0);
    await capture(page, name);
  });
}
