import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const ALL = ['À toi', 'Idées', 'Conceptions', 'Boucle', 'Planning', 'Statistiques', 'Projets', 'Runner et Comptes IA', 'Paramètres'];

/**
 * The Cadre's entries and page are slotted: under the `cd-cadre` host, not
 * under its shadow `nav`, `dialog` and `main`, which the accessibility tree
 * joins but a locator does not. They are found from the host, and where the
 * Cadre shows them is read from their slots.
 */
const cadre = (page: Page) => page.locator('#app > cd-cadre');

/** The link of the menu's entry `label` (its name starts with the label, then its meta in the sheet). */
const entry = (page: Page, label: string) =>
  cadre(page).locator(':scope > cd-menu-item').getByRole('link', { name: new RegExp(`^${label}`) });

/** The menu's `nav` « Menu » the Pilote sees: the sidebar at 1280, the tab bar at 390. */
const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu' });

/** The text of the entries the Cadre shows in `where` (a selector of its shadow root), in the order of its slots. */
const entriesIn = (page: Page, where: string) =>
  cadre(page).evaluate((host, selector) => {
    const box = host.shadowRoot?.querySelector(selector);
    return [...(box?.querySelectorAll('slot') ?? [])]
      .flatMap((slot) => slot.assignedElements())
      .filter((element) => element.localName === 'cd-menu-item')
      .map((item) => (item.shadowRoot?.querySelector('a')?.innerText ?? '').replace(/\s+/g, ' ').trim());
  }, where);

/** The Cadre's banner: the page's header is slotted inside its `main`, which Playwright's roles do not see. */
const topBar = (page: Page) => page.getByRole('banner', { includeHidden: true }).filter({ hasText: 'Crewdeck' });

/** The breadcrumb's link of the library page, the first thing of the page after the menu. */
const pageLink = (page: Page) => page.locator('cd-page-header').getByRole('link', { name: 'Paramètres' });

test.describe('the Cadre at 1280 px', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, 'the sidebar: 1280 px');

  test('the sidebar: the nine entries in order with the separator, Paramètres current, the Runner offline, accessible', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('a-toi-menu-plus');

    await expect(topBar(page)).toBeHidden();
    await expect(menu(page)).toBeVisible();
    await expect.poll(() => entriesIn(page, 'nav.list')).toEqual(ALL);
    await expect(menu(page).getByRole('separator')).toHaveCount(1);
    for (const label of ALL) await expect(entry(page, label)).toBeVisible();
    const current = cadre(page).locator(':scope > cd-menu-item').locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAccessibleName('Paramètres');
    await expect(entry(page, 'Planning')).toHaveAttribute('href', '/planning');
    await expect(page.getByText('Runner hors ligne').filter({ visible: true })).toBeVisible();
    await expect(page.getByText('En direct')).toBeHidden();
    await expect(page.getByRole('main', { name: 'Paramètres' })).toBeVisible();
    await expectAccessible(page);
  });

  test('the keyboard goes through the entries in order, then the page', async ({ page, scenario }) => {
    await scenario('a-toi-menu-plus');

    for (const label of ALL) {
      await page.keyboard.press('Tab');
      await expect(entry(page, label)).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(pageLink(page)).toBeFocused();
  });

  test('a click on an entry opens its page and marks it current', async ({ page, scenario }) => {
    await scenario('a-toi-menu-plus');

    await entry(page, 'Idées').click();
    await expect(page).toHaveURL(/\/idees$/);
    await expect(cadre(page).locator(':scope > cd-menu-item').locator('[aria-current="page"]')).toHaveAccessibleName('Idées');
  });

  test('the library shows the Cadre’s examples, the Pilote at the foot of the default one', async ({ page }) => {
    await page.goto('/parametres/composants?c=Cadre');

    const preview = page.locator('cd-card').filter({ has: page.getByRole('heading', { level: 2, name: /^Aperçu/ }) });
    await expect(preview.locator('cd-cadre')).toHaveCount(4);
    await expect(preview.getByRole('button', { name: 'maximed1412' }).first()).toBeVisible();
    await expect(preview.getByText('Resynchronisation…').filter({ visible: true })).toBeVisible();
    await expect(preview.getByText('Actions sensibles indisponibles').filter({ visible: true })).toBeVisible();
  });
});

test.describe('the Cadre at 390 px', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1280, 'the tab bar: 390 px');

  const SHEET = [
    'Planning Jalons et arbre des Tickets',
    'Statistiques Délai, réussite de la Boucle, coût',
    'Projets',
    'Runner et Comptes IA',
    'Paramètres Rôles, notifications, Planifications',
  ];

  test('the top bar and the tab bar: four entries and « Plus », accessible', async ({ page, scenario, expectAccessible }) => {
    await scenario('a-toi-menu-plus');

    await expect(topBar(page)).toBeVisible();
    await expect(topBar(page)).toContainText('Runner hors ligne');
    await expect.poll(() => entriesIn(page, 'nav.tabs')).toEqual(['À toi', 'Idées', 'Conceptions', 'Boucle']);
    const more = menu(page).getByRole('button', { name: 'Plus' });
    await expect(more).toBeVisible();
    for (const target of [...['À toi', 'Idées', 'Conceptions', 'Boucle'].map((label) => entry(page, label)), more]) {
      await expect(target).toBeVisible();
      const box = await target.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    for (const label of ['Planning', 'Statistiques', 'Projets', 'Runner et Comptes IA', 'Paramètres']) {
      await expect(entry(page, label)).toBeHidden();
    }
    await expectAccessible(page);
  });

  test('« Plus » opens the sheet with the five other entries and their metas, accessible; Escape closes it, back to « Plus »', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('a-toi-menu-plus');

    const more = menu(page).getByRole('button', { name: 'Plus' });
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'Plus' });
    await expect(sheet).toBeVisible();
    await expect.poll(() => entriesIn(page, 'dialog')).toEqual(SHEET);
    for (const label of ['Planning', 'Statistiques', 'Projets', 'Runner et Comptes IA', 'Paramètres']) {
      await expect(entry(page, label)).toBeVisible();
    }
    await expect(entry(page, 'Paramètres')).toHaveAttribute('aria-current', 'page');
    await expectAccessible(page);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('the keyboard opens the sheet, goes through it, and « Fermer » closes it, back to « Plus »', async ({ page, scenario }) => {
    await scenario('a-toi-menu-plus');

    const more = menu(page).getByRole('button', { name: 'Plus' });
    await more.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Plus' });
    await expect(sheet).toBeVisible();
    const close = sheet.getByRole('button', { name: 'Fermer' });
    await expect(close).toBeFocused();
    for (const label of ['Planning', 'Statistiques', 'Projets', 'Runner et Comptes IA', 'Paramètres']) {
      await page.keyboard.press('Tab');
      await expect(entry(page, label)).toBeFocused();
    }
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('an entry of the sheet opens its page and closes the sheet', async ({ page, scenario }) => {
    await scenario('a-toi-menu-plus');

    await menu(page).getByRole('button', { name: 'Plus' }).click();
    await entry(page, 'Planning').click();
    await expect(page).toHaveURL(/\/planning$/);
    await expect(page.getByRole('dialog', { name: 'Plus' })).toBeHidden();
  });
});
