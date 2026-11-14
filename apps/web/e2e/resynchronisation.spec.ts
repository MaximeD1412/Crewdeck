import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { routeSocket } from './socket.js';

/** The Cadre's Banners, slotted under its host. */
const banner = (page: Page) => page.locator('#app > cd-cadre > cd-banner[slot=banner]');
const resyncStatus = (page: Page) => page.getByText('Resynchronisation…', { exact: true }).filter({ visible: true });
/** The Cadre's Pilote, at the sidebar's foot: hidden at 390, where the sidebar is. */
const pilot = (page: Page, name: string) => page.locator('#app > cd-cadre').getByRole('button', { name, includeHidden: true });

/**
 * US-21, ADR 0007: the socket cut, the page shows the Resynchronisation (its
 * Banner with the time of the loss, the Cadre's status) and keeps what it
 * showed; the socket back, the server replays what the page missed, and both
 * go away.
 */
test('cutting the socket shows the Resynchronisation; reconnecting replays the missed event and removes it, accessible in both states', async ({
  page,
  scenario,
  expectAccessible,
  viewport,
}) => {
  const socket = await routeSocket(page);
  const snapshots: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/state') snapshots.push(request.url());
  });

  await scenario('a-toi-resynchronisation');
  await expect(page.getByText('Runner hors ligne').filter({ visible: true })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await expect(pilot(page, 'octocat')).toHaveCount(1);
  expect(snapshots).toHaveLength(1);

  await socket.cut();
  await expect(banner(page)).toHaveCount(1);
  await expect(banner(page)).toContainText(
    /La connexion a été perdue à \d\d:\d\d\. Crewdeck reconstruit l’état ; en attendant, ce que tu vois peut être en retard et les Actions sensibles \(merger, démarrer la Boucle, approuver une Conception\) sont indisponibles\./,
  );
  await expect(banner(page).getByText('Resynchronisation…')).toBeVisible();
  await expect(resyncStatus(page).first()).toBeVisible();
  // Its detail at the sidebar's foot, at 1280 only.
  if ((viewport?.width ?? 0) >= 1280) await expect(page.getByText('Actions sensibles indisponibles').filter({ visible: true })).toBeVisible();
  // What the page showed stays.
  await expect(pilot(page, 'octocat')).toHaveCount(1);
  await expectAccessible(page);

  // A change the page misses: the Pilote renamed while the socket is cut.
  const origin = new URL(page.url()).origin;
  const renamed = await page.request.post('/api/testing/pilot', { data: { displayName: 'renamed' }, headers: { origin } });
  expect(renamed.status(), await renamed.text()).toBe(200);
  await page.waitForTimeout(500);
  await expect(pilot(page, 'octocat')).toHaveCount(1);

  await socket.release();
  await expect(pilot(page, 'renamed')).toHaveCount(1, { timeout: 15_000 });
  await expect(banner(page)).toHaveCount(0);
  await expect(resyncStatus(page)).toHaveCount(0);
  await expect(page.getByText('Runner hors ligne').filter({ visible: true })).toBeVisible();
  // Replayed, not read again: the page asked for no new snapshot.
  expect(snapshots).toHaveLength(1);
  await expectAccessible(page);
});
