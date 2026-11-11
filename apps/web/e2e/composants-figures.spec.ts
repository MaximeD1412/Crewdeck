import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/**
 * What each preview shows once rendered, read through its shadow roots: a
 * Composant of tracks and figures (UI-6) is drawn, not only defined.
 */
const SHOWS: Record<string, { tag: string; examples: number; shows: (page: Page) => Locator }> = {
  ProcessTrack: { tag: 'cd-process-track', examples: 4, shows: (page) => page.locator('cd-process-track').getByRole('listitem').filter({ hasText: 'désactivée' }) },
  UsageMeter: { tag: 'cd-usage-meter', examples: 3, shows: (page) => page.getByRole('meter', { name: 'Fenêtre de 5 h' }) },
  Stat: { tag: 'cd-stat', examples: 2, shows: (page) => page.locator('cd-stat').filter({ hasText: 'Délai Idée → merge' }) },
  CheckRow: { tag: 'cd-check-row', examples: 3, shows: (page) => page.locator('cd-check-row').filter({ hasText: 'échoué' }) },
  Capture: { tag: 'cd-capture', examples: 2, shows: (page) => page.getByRole('button', { name: 'Agrandir : Livré · 390' }) },
  TicketTree: { tag: 'cd-ticket-tree', examples: 1, shows: (page) => page.locator('cd-ticket-tree').getByText('bloqué par #51') },
  Timeline: { tag: 'cd-timeline', examples: 1, shows: (page) => page.locator('cd-timeline').getByText('S46', { exact: true }) },
};

test.describe('the Composants of tracks and figures in the library (/parametres/composants?c=<Name>)', () => {
  for (const [name, { tag, examples, shows }] of Object.entries(SHOWS)) {
    test(`previews every example of ${name}, accessible`, async ({ page, scenario, expectAccessible }) => {
      await scenario(`composants-${name.toLowerCase()}`);

      await expect(page.getByRole('heading', { level: 1, name: 'Bibliothèque de Composants' })).toBeVisible();
      await expect(page.locator(tag)).toHaveCount(examples);
      await expect(shows(page).first()).toBeVisible();
      await expectAccessible(page);
    });
  }
});
