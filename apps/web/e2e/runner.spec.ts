import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const page$ = (page: Page) => page.locator('cd-page-runner');
const rows = (page: Page) => page$(page).locator('cd-card.engines cd-list-row');
const runnerCard = (page: Page) => page$(page).locator('cd-card.runner');
const mcpRows = (page: Page) => page$(page).locator('cd-card.mcp cd-list-row');
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

/** US-73: the Serveurs MCP declared on the Runner, their names only, never a secret; declared on the machine. */
test.describe('« Runner et Comptes IA », its Serveurs MCP (US-73)', () => {
  test('the servers the Runner reports, a new one and a removed one, without reload', async ({ page, scenario, expectAccessible, baseURL }) => {
    await scenario('runner-serveurs-mcp');

    const mcp = page$(page).locator('cd-card.mcp');
    await expect(mcp.getByRole('heading', { name: /Serveurs MCP/ })).toContainText('2');
    await expect(mcpRows(page)).toHaveCount(2);
    await expect(mcpRows(page).nth(0)).toContainText('figma');
    await expect(mcpRows(page).nth(0)).toContainText('HTTP · 4 outils');
    await expect(mcpRows(page).nth(0)).toContainText('déclaré');
    await expect(mcpRows(page).nth(1)).toContainText('stitch');
    await expect(mcpRows(page).nth(1)).toContainText('stdio · 12 outils');
    const declare = page$(page).locator('cd-card.mcp-declare');
    await expect(declare).toContainText('ses secrets restent sur le Runner');
    await expect(declare.locator('cd-code-block')).toContainText('crewdeck-runner mcp add <nom> -- <commande>');
    await expectAccessible(page);

    let reloaded = false;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloaded = true;
    });
    const origin = new URL(baseURL ?? 'http://localhost:4200').origin;
    const report = (servers: unknown[]) => page.request.post('/api/testing/runner/mcp-servers', { data: { servers }, headers: { origin } });

    // `crewdeck-runner mcp add notion --url …`, whose test failed.
    const added = await report([
      { name: 'figma', transport: 'http', state: 'ready', toolCount: 4 },
      { name: 'notion', transport: 'http', state: 'failed', toolCount: null },
      { name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 12 },
    ]);
    expect(added.status(), await added.text()).toBe(204);
    await expect(mcpRows(page)).toHaveCount(3);
    await expect(mcpRows(page).nth(1)).toContainText('notion');
    await expect(mcpRows(page).nth(1)).toContainText('en échec');

    // `crewdeck-runner mcp remove figma`, then `remove notion`, then `remove stitch`.
    const removed = await report([{ name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 12 }]);
    expect(removed.status(), await removed.text()).toBe(204);
    await expect(mcpRows(page)).toHaveCount(1);
    await expect(mcpRows(page).nth(0)).toContainText('stitch');

    const none = await report([]);
    expect(none.status(), await none.text()).toBe(204);
    await expect(mcpRows(page)).toHaveCount(0);
    await expect(mcp).toContainText('Aucun Serveur MCP déclaré.');
    expect(reloaded).toBe(false);
  });
});
