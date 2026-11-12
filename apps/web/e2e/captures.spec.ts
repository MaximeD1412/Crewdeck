/**
 * The captures of a visual review, written by `scripts/captures.sh`:
 * `CAPTURES_SCENARIOS` (comma-separated scenario names, the ids of
 * `design/screens.json`) into `CAPTURES_DIR`, once per project (390 and 1280 px).
 */
import type { Page } from '@playwright/test';
import { openConfirm } from './confirm.js';
import { expect, test } from './fixtures.js';
import { linkFirstAppareil } from './runner-link.js';
import { routeSocket } from './socket.js';

/** The Paramètres' « Appareils », this browser linked first: its first trusted Appareil (E2E-3). */
const appareils = async (page: Page) => {
  await linkFirstAppareil(page, undefined);
  await page.goto('/parametres');
  await page.getByRole('navigation', { name: 'Paramètres / Sections' }).getByRole('link', { name: 'Appareils' }).click();
  await expect(page.locator('cd-page-parametres > cd-card[slot=devices]')).toBeVisible();
};

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
  // A new Appareil: the Cadre's Banner, then its dialog with the QR code and the code (E2E-3).
  'appareil-a-approuver': async (page) => {
    await expect(page.locator('#app > cd-cadre > cd-banner[slot=banner]')).toContainText('Cet Appareil ne lit pas encore');
  },
  'appareil-a-approuver-code': async (page) => {
    await page.locator('#app > cd-cadre > cd-banner[slot=banner]').getByRole('button', { name: 'Approuver cet Appareil' }).click();
    await expect(page.getByRole('img', { name: 'QR code de cet Appareil' })).toBeVisible();
    await expect(page.locator('crewdeck-new-device code').first()).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{26}$/);
  },
  appareils,
  'appareils-ajouter': async (page) => {
    await appareils(page);
    await page.locator('cd-page-parametres > cd-card[slot=devices]').getByRole('button', { name: 'Ajouter un Appareil' }).click();
    await expect(page.getByLabel('Colle le code affiché sur le nouvel Appareil')).toBeFocused();
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
  },
};

/** The scenarios whose capture is the screen, not the whole page: a modal over it. */
const SCREEN_ONLY: ReadonlySet<string> = new Set(['confirm-dialog', 'appareil-a-approuver-code', 'appareils-ajouter']);

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
