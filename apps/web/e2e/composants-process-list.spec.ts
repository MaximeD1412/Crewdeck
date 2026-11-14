import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/**
 * The preview of the library page, one figure per example: from its `cd-card`
 * host, as its figures are slotted, not under the card's shadow region.
 */
const preview = (page: Page) =>
  page.locator('cd-card').filter({ has: page.getByRole('heading', { level: 2, name: /^Aperçu/ }) });

/** The figure of one example, by its caption. */
const example = (page: Page, name: string) =>
  preview(page).locator('figure').filter({ has: page.locator('figcaption', { hasText: new RegExp(`^${name}$`) }) });

/** The Composants of a Process's list and its editing (UI-9), each opened in the library. */
const PROCESS_LIST = [
  { name: 'PhaseGroup', tag: 'cd-phase-group', examples: 2 },
  { name: 'StepRow', tag: 'cd-step-row', examples: 4 },
  { name: 'Stepper', tag: 'cd-stepper', examples: 2 },
  { name: 'Menu', tag: 'cd-menu', examples: 2 },
] as const;

test.describe('the Composants of a Process’s list and its editing in the library (/parametres/composants?c=<Name>)', () => {
  for (const { name, tag, examples } of PROCESS_LIST) {
    test(`previews every example of ${name}, accessible`, async ({ page, scenario, expectAccessible }) => {
      await scenario(`composants-${name.toLowerCase()}`);

      await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^${name}$`) })).toBeVisible();
      await expect(preview(page).locator(`figure > .stage > ${tag}`)).toHaveCount(examples);
      await expectAccessible(page);
    });
  }

  test('a PhaseGroup folds and unfolds on its summary, its Manques in a badge', async ({ page, scenario }) => {
    await scenario('composants-phasegroup');

    const group = example(page, 'ouverte, répétée pour chaque Ticket');
    const open = group.locator('details');
    await expect(open).toHaveAttribute('open', '');
    await expect(open.locator('summary')).toContainText('pour chaque Ticket prêt · 5 Étapes · 2 Retours');
    await expect(open.locator('summary')).toContainText('1 Manque');
    await expect(group.locator('cd-phase-group > cd-step-row')).toHaveCount(2);
    await open.locator('summary').click();
    await expect(open).not.toHaveAttribute('open', '');

    const folded = example(page, 'repliée').locator('details');
    await expect(folded).not.toHaveAttribute('open', '');
    await folded.locator('summary').click();
    await expect(folded).toHaveAttribute('open', '');
  });

  test('a StepRow shows its Retour and its Manque', async ({ page, scenario }) => {
    await scenario('composants-steprow');

    await expect(example(page, 'avec un Retour')).toContainText('Retour vers « Code », 3 fois au plus');
    await expect(example(page, 'avec un Manque')).toContainText('Aucune Commande attachée');
  });

  test('a Stepper is a group named by its label, « Moins » disabled at its minimum', async ({ page, scenario }) => {
    await scenario('composants-stepper');

    const max = example(page, 'le maximum d’un Retour').getByRole('group', { name: 'Au plus' });
    await expect(max.getByRole('status')).toHaveText('3 fois');
    await expect(max.getByRole('button', { name: 'Moins' })).toBeEnabled();
    await expect(max.getByRole('button', { name: 'Plus' })).toBeEnabled();
    const min = example(page, 'à son minimum').getByRole('group', { name: 'Au minimum' });
    await expect(min.getByRole('button', { name: 'Moins' })).toBeDisabled();
  });

  test('a Menu moves with the arrows over its enabled items only, wrapping', async ({ page, scenario }) => {
    await scenario('composants-menu');

    const menu = example(page, 'attacher un Outil').getByRole('menu', { name: 'Attacher à « Review »' });
    await expect(menu.getByRole('group', { name: 'Serveur MCP' })).toBeVisible();
    const review = menu.getByRole('menuitem', { name: /^Review/ });
    await expect(review).toContainText('choisi');
    await expect(menu.getByRole('menuitem', { name: /^Stitch/ })).toHaveAttribute('aria-disabled', 'true');

    await review.focus();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: /^Conception/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: /^Figma/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(review).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: /^Figma/ })).toBeFocused();
  });
});
