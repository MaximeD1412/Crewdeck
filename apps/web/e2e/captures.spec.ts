/**
 * The captures of a visual review, written by `scripts/captures.sh`:
 * `CAPTURES_SCENARIOS` (comma-separated scenario names, the ids of
 * `design/screens.json`) into `CAPTURES_DIR`, once per project (390 and 1280 px).
 */
import { test } from './fixtures.js';

const names = (process.env['CAPTURES_SCENARIOS'] ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

test.skip(names.length === 0 || !process.env['CAPTURES_DIR'], 'CAPTURES_SCENARIOS et CAPTURES_DIR : à lancer par scripts/captures.sh');

for (const name of names) {
  test(`capture ${name}`, async ({ page, scenario, capture }) => {
    await scenario(name);
    await page.waitForLoadState('networkidle');
    await capture(page, name);
  });
}
