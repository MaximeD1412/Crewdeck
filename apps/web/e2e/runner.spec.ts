import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const page$ = (page: Page) => page.locator('cd-page-runner');
const rows = (page: Page) => page$(page).locator('cd-card.engines cd-list-row');
const runnerCard = (page: Page) => page$(page).locator('cd-card.runner');
const visible = (page: Page, text: string) => page.getByText(text, { exact: true }).filter({ visible: true });
const desktop = (viewport: { width: number } | null) => (viewport?.width ?? 0) >= 1280;

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
