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

const SESSION_COMPOSANTS = [
  { name: 'Session', scenario: 'composants-session', tag: 'cd-session', examples: 6 },
  { name: 'Message', scenario: 'composants-message', tag: 'cd-message', examples: 2 },
  { name: 'ToolCall', scenario: 'composants-tool-call', tag: 'cd-tool-call', examples: 2 },
  { name: 'Question', scenario: 'composants-question', tag: 'cd-question', examples: 2 },
  { name: 'PermissionRequest', scenario: 'composants-permission-request', tag: 'cd-permission-request', examples: 1 },
  { name: 'Composer', scenario: 'composants-composer', tag: 'cd-composer', examples: 4 },
] as const;

test.describe('the Session Composants in the library (/parametres/composants)', () => {
  for (const { name, scenario: id, tag, examples } of SESSION_COMPOSANTS) {
    test(`shows ${name}, its examples, accessible`, async ({ page, scenario, expectAccessible }) => {
      await scenario(id);

      if (test.info().project.name === 'phone') {
        // The phone picks a Composant through the Select « Composant », the catalogue is for 1280 px.
        await expect(page.getByRole('combobox', { name: 'Composant', exact: true })).toHaveValue(name);
      } else {
        const catalogue = page.getByRole('navigation', { name: 'Catalogue des Composants' });
        await expect(catalogue.getByRole('link', { name: new RegExp(`^${name} ouvert$`) })).toBeVisible();
      }
      await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^${name}$`) })).toBeVisible();
      await expect(preview(page).locator(`figure > .stage > ${tag}`)).toHaveCount(examples);

      await expectAccessible(page);
    });
  }

  test('a Session shows « Arrêter » while it runs, « Reprendre » once stopped, disabled with its reason', async ({ page, scenario }) => {
    await scenario('composants-session');

    await expect(example(page, 'active').getByRole('button', { name: 'Arrêter' })).toBeVisible();
    await expect(example(page, 'arrêtée').getByRole('button', { name: 'Reprendre' })).toBeEnabled();
    const interrupted = example(page, 'interrompue, Runner hors ligne');
    await expect(interrupted.getByRole('button', { name: 'Reprendre' })).toBeDisabled();
    await expect(interrupted).toContainText('Runner hors ligne');
    await expect(example(page, 'en attente d’une réponse')).toContainText('attend ta réponse');
    await expect(example(page, 'active').getByRole('log', { name: 'Conversation' })).toBeVisible();
  });

  test('a Session closes by its back arrow on a phone, by « Fermer » and « Agrandir » at 1280 px', async ({ page, scenario }, testInfo) => {
    await scenario('composants-session');

    const session = example(page, 'active');
    const wide = (testInfo.project.use.viewport?.width ?? 0) >= 1280;
    await expect(session.getByRole('button', { name: 'Retour' })).toBeVisible({ visible: !wide });
    await expect(session.getByRole('button', { name: 'Fermer' })).toBeVisible({ visible: wide });
    await expect(session.getByRole('button', { name: 'Agrandir' })).toBeVisible({ visible: wide });
  });

  test('the Composer sends on Enter and breaks a line on Shift+Enter', async ({ page, scenario }) => {
    await scenario('composants-composer');

    const field = example(page, 'vide').getByRole('textbox', { name: 'Écrire à l’agent, ou dicter' });
    await field.click();
    await page.keyboard.type('Une');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('deux');
    await expect(field).toHaveValue('Une\ndeux');

    await page.keyboard.press('Enter');
    await expect(field).toHaveValue('');
    await expect(example(page, 'vide').getByRole('button', { name: 'Envoyer' })).toBeVisible();
    await expect(example(page, 'dictée en cours').getByRole('button', { name: 'Arrêter la dictée' })).toHaveAttribute('aria-pressed', 'true');
    await expect(example(page, 'désactivé').getByRole('textbox')).toBeDisabled();
  });

  test('a Question moves between its options with the arrows, then answers', async ({ page, scenario }) => {
    await scenario('composants-question');

    const question = example(page, 'une option, la Reco choisie');
    const options = question.getByRole('radiogroup');
    await expect(options.getByRole('radio')).toHaveCount(3);
    await expect(options.getByRole('radio', { name: /^Tous les membres/ })).toBeChecked();

    await options.getByRole('radio', { name: /^Tous les membres/ }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(options.getByRole('radio', { name: /^Seulement son auteur/ })).toBeChecked();
    await expect(options.getByRole('radio', { name: /^Seulement son auteur/ })).toBeFocused();
    await expect(question.getByRole('button', { name: 'Répondre' })).toBeEnabled();

    const several = example(page, 'plusieurs options');
    await expect(several.getByRole('checkbox')).toHaveCount(3);
  });

  test('a PermissionRequest shows the command and its three answers', async ({ page, scenario }) => {
    await scenario('composants-permission-request');

    const request = example(page, 'un git push');
    await expect(request.getByRole('heading', { level: 3, name: 'Bash demande ta permission' })).toBeVisible();
    await expect(request.locator('pre code')).toHaveText('git push origin design/agenda-partage');
    for (const label of ['Autoriser', 'Autoriser pour la session', 'Refuser']) {
      await expect(request.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
  });

  test('a Message renders the agent’s Markdown, its links opening apart', async ({ page, scenario }) => {
    await scenario('composants-message');

    const agent = example(page, 'de l’agent');
    await expect(agent.locator('strong').first()).toBeVisible();
    const link = agent.getByRole('link').first();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(example(page, 'du Pilote').locator('time')).toHaveAttribute('datetime', /.+/);
  });
});
