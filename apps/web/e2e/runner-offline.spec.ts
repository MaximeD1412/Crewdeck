import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const banner = (page: Page) => page.locator('#app > cd-cadre > cd-banner[slot=banner]');
const offlineRow = (page: Page) => page.locator('cd-page-a-toi cd-decision-row').filter({ hasText: 'Le travail attend dans' });
/** A part of a Décision's row, read through its shadow root. */
const part = (page: Page, selector: string) =>
  offlineRow(page).evaluate((row, selector) => (row.shadowRoot?.querySelector(selector) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim(), selector);
const visible = (page: Page, text: string) => page.getByText(text, { exact: true }).filter({ visible: true });

/** From the page: its Origin, as a page's POST carries it. */
const post = async (page: Page, path: string, data: unknown = {}) => {
  const response = await page.request.post(path, { data, headers: { origin: new URL(page.url()).origin } });
  expect(response.status(), await response.text()).toBeLessThan(300);
};

const CREWDECK = { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01', name: 'Crewdeck', items: [{ kind: 'ticket-in-progress', number: 44 }] };
const SITE_MAIRIE = { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03', name: 'Site mairie', items: [{ kind: 'ticket-interrupted', number: 47 }] };
const IDEAS = { projectId: null, name: 'Idées', items: [{ kind: 'ideas-waiting', count: 2 }] };

/** US-19, ATOI-3: the Runner offline while work waits, one Décision in « À toi » and the banners. */
test.describe('« Runner hors ligne » (US-19)', () => {
  test('« À toi »: one Décision listing the Projets whose work waits, the banner, « Voir le Runner » leading to /runner', async ({
    page,
    scenario,
    expectAccessible,
    capture,
  }) => {
    await scenario('a-toi-runner-hors-ligne');

    await expect(offlineRow(page)).toHaveCount(1);
    expect(await part(page, '.open')).toBe('Runner hors ligne · Le travail attend dans 3 Projets');
    expect(await part(page, '.meta')).toBe('3 Projets · depuis 14:02');
    await expect(offlineRow(page)).toContainText('Crewdeck : #44 en cours · Personal OS : #53 en cours, 2 Tickets prêts · Site mairie : #47 interrompu');
    await expect(banner(page)).toContainText('Runner hors ligne');
    await expect(banner(page)).toContainText(
      'Ton Runner ne répond plus depuis 14:02. Le travail attend dans 3 Projets : Crewdeck (#44 en cours), Personal OS (#53 en cours, 2 Tickets prêts), Site mairie (#47 interrompu). Relance-le sur ta machine.',
    );
    // The nine other Décisions stay listed beside it.
    await expect(page.locator('cd-page-a-toi cd-decision-row')).toHaveCount(10);
    await expectAccessible(page);
    await capture(page, 'a-toi-runner-hors-ligne');

    await banner(page).getByRole('button', { name: 'Voir le Runner' }).click();
    await expect(page).toHaveURL(/\/runner$/);
    await expect(page.locator('cd-page-runner cd-card.runner')).toContainText('hors ligne depuis 14:02');
  });

  test('« Runner et Comptes IA »: « Rien ne tourne », the Projets that wait, the command that relaunches it', async ({ page, scenario, expectAccessible, capture }) => {
    await scenario('runner-hors-ligne');

    await expect(page.locator('cd-page-runner cd-card.runner')).toContainText('hors ligne depuis 14:02');
    await expect(banner(page)).toContainText('Runner hors ligne');
    await expect(banner(page)).toContainText('Rien ne tourne : le travail attend dans Crewdeck, Personal OS et Site mairie. Relance le Runner sur ta machine.');
    await expect(banner(page).locator('cd-code-block')).toContainText('crewdeck-runner restart');
    await expectAccessible(page);
    await capture(page, 'runner-hors-ligne');
  });

  test('live: raised as the Runner goes offline, updated with new work, gone once it is back, never two', async ({ page, scenario }) => {
    await scenario('runner');
    await post(page, '/api/testing/runner/waiting-work', { projects: [CREWDECK] });
    await page.goto('/a-toi');
    await expect(page.locator('cd-page-a-toi')).toBeVisible();
    await expect(offlineRow(page)).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);

    await post(page, '/api/testing/runner/disconnect');
    await expect(offlineRow(page)).toHaveCount(1);
    expect(await part(page, '.open')).toBe('Runner hors ligne · Le travail attend dans 1 Projet');
    await expect(banner(page)).toContainText('Le travail attend dans 1 Projet : Crewdeck (#44 en cours).');

    await post(page, '/api/testing/runner/waiting-work', { projects: [CREWDECK, SITE_MAIRIE, IDEAS] });
    await expect(offlineRow(page)).toContainText('Site mairie : #47 interrompu · Idées : 2 Idées en attente');
    await expect(offlineRow(page)).toHaveCount(1);
    expect(await part(page, '.open')).toBe('Runner hors ligne · Le travail attend dans 3 Projets');
    await expect(banner(page)).toContainText('Le travail attend dans 3 Projets');

    await post(page, '/api/testing/runner/reconnect');
    await expect(offlineRow(page)).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
    await expect(visible(page, 'Runner hors ligne')).toHaveCount(0);
  });

  test('no work waiting: no Décision, the Cadre alone says « Runner hors ligne »', async ({ page, scenario }) => {
    await scenario('runner');
    await page.goto('/a-toi');
    await expect(page.locator('cd-page-a-toi')).toBeVisible();

    await post(page, '/api/testing/runner/disconnect');
    await expect(visible(page, 'Runner hors ligne')).toHaveCount(1);
    await expect(offlineRow(page)).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
  });
});
