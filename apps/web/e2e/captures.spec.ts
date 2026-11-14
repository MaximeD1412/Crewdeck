/**
 * The captures of a visual review, written by `scripts/captures.sh`:
 * `CAPTURES_SCENARIOS` (comma-separated scenario names, the ids of
 * `design/screens.json`) into `CAPTURES_DIR`, once per project (390 and 1280 px).
 */
import type { Page } from '@playwright/test';
import { openConfirm } from './confirm.js';
import { expect, test } from './fixtures.js';
import { routeSocket } from './socket.js';

/** What a scenario's capture shows beyond its page: a sheet or a dialog opened, by width. */
const PREPARE: Readonly<Record<string, (page: Page, width: number) => Promise<void>>> = {
  // The socket cut once live, at the mockup's time of the loss.
  'a-toi-resynchronisation': async (page) => {
    await page.clock.setFixedTime(new Date('2026-11-11T15:12:00+01:00'));
    const socket = await routeSocket(page);
    await page.reload();
    await expect(page.getByText('Runner hors ligne').filter({ visible: true })).toBeVisible();
    await socket.cut();
    await expect(page.locator('#app > cd-cadre > cd-banner[slot=banner]')).toContainText('15:12');
  },
  // The core's confirmation of an Action sensible, over the library (CORE-7).
  'confirm-dialog': openConfirm,
  'a-toi-menu-plus': async (page, width) => {
    if (width < 1280) await page.getByRole('button', { name: 'Plus' }).click();
  },
  // The page draws its code once the snapshot is there: its command shown.
  demarrage: async (page) => {
    await expect(page.locator('cd-page-demarrage cd-code-block')).toContainText('--link');
  },
  'demarrage-liaison-echouee': async (page) => {
    await expect(page.locator('cd-page-demarrage cd-code-block')).toContainText('--link');
  },
  'demarrage-runner-relie': async (page) => {
    await expect(page.locator('cd-page-demarrage cd-banner')).toContainText('Runner en ligne');
  },
  'demarrage-comptes-ia': async (page) => {
    await expect(page.locator('cd-page-demarrage cd-card[data-engine=claude-code]')).toContainText('connecté · abonnement');
  },
  'demarrage-comptes-ia-aucun': async (page) => {
    await expect(page.locator('cd-page-demarrage cd-banner')).toContainText('Aucun Moteur utilisable');
  },
  runner: async (page) => {
    await expect(page.locator('cd-page-runner cd-card.runner')).toContainText('en ligne');
  },
  'runner-hors-ligne': async (page) => {
    await expect(page.locator('cd-page-runner cd-card.runner')).toContainText('hors ligne');
    await expect(page.locator('#app > cd-cadre > cd-banner[slot=banner] cd-code-block')).toContainText('crewdeck-runner restart');
  },
  // « Runner hors ligne » (ATOI-3): its row among the Décisions, and its banner.
  'a-toi-runner-hors-ligne': async (page) => {
    await expect(page.locator('#app > cd-cadre > cd-banner[slot=banner]')).toContainText('Ton Runner ne répond plus');
    await expect(page.locator('cd-page-a-toi cd-decision-row')).toHaveCount(10);
  },
};

/** The scenarios whose capture is the screen, not the whole page: a modal over it. */
const SCREEN_ONLY: ReadonlySet<string> = new Set(['confirm-dialog']);

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
    await capture(page, name, { fullPage: !SCREEN_ONLY.has(name) });
  });
}
