import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const page$ = (page: Page) => page.locator('cd-page-runner');
const rows = (page: Page) => page$(page).locator('cd-card.engines cd-list-row');
const runnerCard = (page: Page) => page$(page).locator('cd-card.runner');
const visible = (page: Page, text: string) => page.getByText(text, { exact: true }).filter({ visible: true });
const desktop = (viewport: { width: number } | null) => (viewport?.width ?? 0) >= 1280;
/** The card « Usage des Comptes IA », in the page's Emplacement `usage` (RUNNER-13). */
const usage = (page: Page) => page$(page).locator('cd-usage-card[slot=usage]');
const meter = (page: Page, name: string) => usage(page).getByRole('meter', { name });
const HOUR = /\d{2}:\d{2}/.source;
const DAY = /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/.source;

/** From the page: its Origin, as a page's POST carries it. */
const post = async (page: Page, path: string, data: unknown) => {
  const response = await page.request.post(path, { data, headers: { origin: new URL(page.url()).origin } });
  expect(response.status(), await response.text()).toBeLessThan(300);
};

/** US-38: « Runner et Comptes IA », every model of every Moteur, usable or why not, the connection command, the Runner card. */
test.describe('« Runner et Comptes IA » (US-38)', () => {
  test('the Runner online: the Moteurs and their models, the connection command, the machine', async ({ page, scenario, expectAccessible, viewport }) => {
    await scenario('runner');

    await expect(page$(page).getByRole('heading', { level: 1, name: 'Runner et Comptes IA' })).toBeVisible();
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).nth(0)).toContainText('claude-opus-5-5');
    await expect(rows(page).nth(0)).toContainText('Claude Code · Compte IA Claude');
    await expect(rows(page).nth(0)).toContainText('disponible');
    await expect(rows(page).nth(2)).toContainText('indisponible avec cet abonnement');
    await expect(rows(page).nth(4)).toContainText('gpt-5.5-pro');
    await expect(rows(page).nth(4)).toContainText('quota atteint');
    await expect(page$(page).locator('cd-card.connect')).toContainText('Sur ta machine, jamais ici :');
    await expect(page$(page).locator('cd-card.connect cd-code-block')).toContainText('crewdeck-runner login claude');
    await expect(page$(page).getByRole('textbox')).toHaveCount(0);
    await expect(runnerCard(page)).toContainText('en ligne');
    await expect(runnerCard(page)).toContainText('atelier-pc');
    await expect(runnerCard(page)).toContainText('Windows (WSL) · amd64');
    await expect(runnerCard(page)).toContainText('0.4.2');
    await expect(runnerCard(page)).toContainText('chiffrés de bout en bout');
    // The Cadre agrees: « En direct », and at 1280 the Moteurs connected.
    await expect(visible(page, 'En direct')).toHaveCount(1);
    await expect(visible(page, 'Runner hors ligne')).toHaveCount(0);
    if (desktop(viewport)) await expect(visible(page, 'Claude Code, Codex')).toHaveCount(1);
    await expectAccessible(page);
  });

  test('the Runner offline: since its last heartbeat, the Comptes IA as it last reported them', async ({ page, scenario, expectAccessible, viewport }) => {
    await scenario('runner-hors-ligne');

    await expect(runnerCard(page)).toContainText('hors ligne depuis 14:02');
    await expect(visible(page, 'Runner hors ligne')).toHaveCount(1);
    await expect(visible(page, 'En direct')).toHaveCount(0);
    if (desktop(viewport)) await expect(visible(page, 'depuis 14:02')).toHaveCount(1);
    await expect(rows(page)).toHaveCount(5);
    await expectAccessible(page);
  });
});

/** US-55: the usage of each Compte IA against its limits, the projection at the current pace, the month's spend in euros. */
test.describe('« Usage des Comptes IA » (US-55)', () => {
  test('online: the windows of the subscription with their projection, the spend of the API key; a measure updates it without a reload', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('runner');

    await expect(usage(page).getByRole('heading', { level: 2, name: 'Usage des Comptes IA' })).toBeVisible();
    await expect(usage(page).getByRole('heading', { level: 3 })).toHaveText(['Claude · abonnement', 'Codex · clé API']);
    await expect(meter(page, 'Fenêtre de 5 h')).toHaveAttribute('aria-valuenow', '100');
    await expect(usage(page)).toContainText(new RegExp(`Limite atteinte ; réinitialisation à ${HOUR}\\.`));
    await expect(meter(page, 'Semaine')).toHaveAttribute('aria-valuenow', '62');
    await expect(usage(page)).toContainText(new RegExp(`Réinitialisation ${DAY} ; au rythme actuel, la semaine tient jusqu’à ${DAY}\\.`));
    await expect(usage(page)).toContainText('Dépense estimée du mois');
    await expect(usage(page)).toContainText('21,60\u00a0€');
    await expect(usage(page)).not.toContainText('Dernière mesure');
    await expectAccessible(page);

    const loads: string[] = [];
    page.on('load', () => loads.push(page.url()));
    // A new 5-hour window: the limit is behind, the reset five hours away.
    const now = Date.now();
    await post(page, '/api/testing/runner/usage', {
      engine: 'claude-code',
      accountKind: 'subscription',
      windows: [{ id: 'five-hour', usedPercent: 4, resetsAt: new Date(now + 5 * 3_600_000).toISOString() }],
      measuredAt: new Date(now).toISOString(),
    });
    await expect(meter(page, 'Fenêtre de 5 h')).toHaveAttribute('aria-valuenow', '4');
    await expect(usage(page)).not.toContainText('Limite atteinte');
    expect(loads).toEqual([]);
  });

  test('offline: the last measures, only their resets, and when they were taken', async ({ page, scenario, expectAccessible }) => {
    await scenario('runner-hors-ligne');

    await expect(usage(page).getByRole('heading', { level: 3 })).toHaveText(['Claude · abonnement', 'Codex · clé API']);
    await expect(usage(page)).toContainText('Dernière mesure à 14:02, avant que le Runner se coupe.');
    await expect(meter(page, 'Fenêtre de 5 h')).toHaveAttribute('aria-valuenow', '100');
    await expect(usage(page)).toContainText(new RegExp(`Réinitialisation à ${HOUR}\\.`));
    await expect(usage(page)).toContainText(new RegExp(`Réinitialisation ${DAY}\\.`));
    await expect(usage(page)).not.toContainText('au rythme actuel');
    await expect(usage(page)).not.toContainText('Limite atteinte');
    await expectAccessible(page);
  });
});
