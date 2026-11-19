import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/** The Session of the scenarios (`apps/server/src/testing/scenarios/session.ts`). */
const SESSION_ID = '019a6f1e-7c3d-7e4f-9a1b-5e5510000001';

const panel = (page: Page) => page.locator('#app > cd-cadre > cd-session[slot=panel]');
const banner = (page: Page) => page.locator('#app > cd-cadre > cd-banner[slot=banner]');
const composer = (page: Page, name: string) => panel(page).getByRole('textbox', { name });

/** From the page: its Origin, as a page's POST carries it. */
const post = async (page: Page, path: string) => {
  const response = await page.request.post(path, { data: {}, headers: { origin: new URL(page.url()).origin } });
  expect(response.status(), await response.text()).toBeLessThan(300);
};

/** The conversation the fake Runner relays: its first message, its list, its last read. */
const expectConversation = async (page: Page) => {
  await expect(panel(page)).toContainText('L’Idée demande un agenda que plusieurs personnes partagent.');
  await expect(panel(page)).toContainText('qui peut modifier ses événements');
  await expect(panel(page)).toContainText('docs/product/features/agenda.md');
  await expect(panel(page)).toContainText('96 lignes');
};

/** US-9, US-60, SESSION-2: the Session panel over a page, read as it streams, written to, stopped and resumed. */
test.describe('the Session panel (US-9, US-60)', () => {
  test('reads the conversation the Runner relays end-to-end encrypted, then the agent’s answer to the Pilote’s message', async ({
    page,
    scenario,
    expectAccessible,
    capture,
  }) => {
    await scenario('session');

    await expect(panel(page)).toContainText('Concevoir · Agenda partagé');
    await expect(panel(page)).toContainText('Personal OS · Conception · Claude Code');
    await expectConversation(page);
    await expect(panel(page)).toContainText('Claude Code travaille');
    await expect(panel(page).getByRole('button', { name: 'Arrêter' })).toBeVisible();
    // The page under it stays: « À toi » and its Décisions.
    await expect(page.locator('cd-page-a-toi cd-decision-row')).toHaveCount(9);
    await expectAccessible(page);
    await capture(page, 'session');

    const field = composer(page, 'Écrire à l’agent, ou dicter');
    await field.fill('Pense aux événements récurrents.');
    await field.press('Enter');
    await expect(panel(page)).toContainText('Pense aux événements récurrents.');
    await expect(panel(page)).toContainText('Noté : « Pense aux événements récurrents. ».');
  });

  test('« Arrêter » stops it, the Banner says when; « Reprendre » runs it again', async ({ page, scenario }) => {
    await scenario('session');
    await expectConversation(page);

    await panel(page).getByRole('button', { name: 'Arrêter' }).click();
    await expect(panel(page)).toContainText(/Session arrêtée par toi à \d\d:\d\d/);
    await expect(composer(page, 'Écrire pour reprendre la session')).toBeVisible();
    await expect(panel(page)).not.toContainText('Claude Code travaille');

    await panel(page).getByRole('button', { name: 'Reprendre' }).click();
    await expect(panel(page).getByRole('button', { name: 'Arrêter' })).toBeVisible();
    await expect(panel(page)).not.toContainText('Session arrêtée par toi');
    await expect(composer(page, 'Écrire à l’agent, ou dicter')).toBeVisible();
  });

  test('stopped at 15:12: its conversation and the stop Banner; writing to it resumes it, then sends', async ({ page, scenario, expectAccessible, capture }) => {
    await scenario('session-arretee');

    await expectConversation(page);
    await expect(panel(page)).toContainText('Session arrêtée par toi à 15:12');
    await expect(panel(page)).toContainText('Écris pour la reprendre là où elle s’est arrêtée, ou touche « Reprendre ».');
    await expect(panel(page).getByRole('button', { name: 'Reprendre' })).toBeEnabled();
    await expectAccessible(page);
    await capture(page, 'session-arretee');

    const field = composer(page, 'Écrire pour reprendre la session');
    await field.fill('Continue avec les questions.');
    await field.press('Enter');
    await expect(panel(page).getByRole('button', { name: 'Arrêter' })).toBeVisible();
    await expect(panel(page)).toContainText('Noté : « Continue avec les questions. ».');
  });

  test('the Runner offline: only its title and state, the Banner, « Reprendre » and the Composer disabled', async ({ page, scenario, expectAccessible, capture }, testInfo) => {
    await scenario('session-runner-hors-ligne');

    await expect(panel(page)).toContainText('Concevoir · Agenda partagé');
    await expect(panel(page)).toContainText('Runner hors ligne · Personal OS · Conception · Claude Code');
    await expect(panel(page)).toContainText('Conversation sur ton Runner');
    await expect(panel(page)).not.toContainText('L’Idée demande un agenda');
    await expect(panel(page).getByRole('button', { name: 'Reprendre' })).toBeDisabled();
    await expect(composer(page, 'Disponible quand ton Runner est en ligne')).toBeDisabled();
    await expect(banner(page)).toContainText('Ton Runner ne répond plus depuis 14:02. Les sessions reprendront quand il sera de nouveau en ligne.');
    // Beside the panel at 1280 px; on a phone the panel covers the page and its Banner, as in the mockup: its meta says « Runner hors ligne ».
    if (testInfo.project.name === 'desktop') await expect(banner(page)).toBeVisible();
    await expect(panel(page).getByText('Runner hors ligne ·', { exact: false })).toBeVisible();
    await expectAccessible(page);
    await capture(page, 'session-runner-hors-ligne');

    await panel(page).getByRole('button', { name: 'Voir le Runner' }).click();
    await expect(page).toHaveURL(/\/runner$/);
  });

  test('live: the conversation gone while the Runner is away, back once it is, the Session interrupted', async ({ page, scenario }) => {
    await scenario('session');
    await expectConversation(page);
    await composer(page, 'Écrire à l’agent, ou dicter').fill('Un brouillon pas encore envoyé.');

    await post(page, '/api/testing/runner/disconnect');
    await expect(panel(page)).toContainText('Conversation sur ton Runner');
    await expect(panel(page)).not.toContainText('L’Idée demande un agenda');
    await expect(panel(page).getByRole('button', { name: 'Reprendre' })).toBeDisabled();
    // Nothing of the content stays in the page, the Pilote's draft neither.
    await expect(composer(page, 'Disponible quand ton Runner est en ligne')).toHaveValue('');

    await post(page, '/api/testing/runner/reconnect');
    await expectConversation(page);
    await expect(panel(page).getByRole('button', { name: 'Reprendre' })).toBeEnabled();
  });

  test('a Session that is not the Pilote’s: « Session introuvable », « Fermer » back to the page', async ({ page, scenario }) => {
    await scenario('session');
    await expectConversation(page);

    await page.goto('/a-toi?session=019a6f1e-7c3d-7e4f-9a1b-5e55100000ff');
    await expect(page.locator('#app > cd-cadre > cd-empty[slot=panel]')).toContainText('Session introuvable');
    await page.locator('#app > cd-cadre > cd-empty[slot=panel]').getByRole('button', { name: 'Fermer' }).click();
    await expect(page).toHaveURL(/\/a-toi$/);
    await expect(page.locator('#app > cd-cadre > [slot=panel]')).toHaveCount(0);
  });

  test('the Session of the URL opens over any page', async ({ page, scenario }) => {
    await scenario('session');
    await page.goto(`/runner?session=${SESSION_ID}`);
    await expectConversation(page);
    // Under it: beside it at 1280 px, covered on a phone.
    await expect(page.locator('cd-page-runner')).toBeAttached();
  });
});

const row = (page: Page, kind: string) => page.locator('cd-page-a-toi cd-decision-row').filter({ hasText: kind });
const QUESTION = 'Qui peut modifier un événement d’un agenda partagé ?';

/** US-9, US-17, SESSION-3: a question or a permission request of the agent, answered from the panel, raised in « À toi ». */
test.describe('the requests of a Session (SESSION-3)', () => {
  test('a question: its options in the panel, « Répondre » sends the one chosen, the agent goes on, the Décision leaves « À toi »', async ({
    page,
    scenario,
    expectAccessible,
    capture,
  }) => {
    await scenario('session-question');

    const question = panel(page).locator('cd-question');
    await expect(question).toContainText('Question 1 sur 3');
    await expect(question).toContainText(QUESTION);
    await expect(question).toContainText('Tous les membres de l’agenda');
    await expect(question).toContainText('Les autres membres le voient en lecture seule.');
    await expect(question.getByRole('button', { name: 'Répondre' })).toBeDisabled();
    await expect(composer(page, 'Ou réponds avec tes mots')).toBeVisible();
    // Its Décision, under the panel: the question read from the Runner, nothing of it in the row the server holds.
    await expect(row(page, 'Question de l’agent')).toContainText(QUESTION);
    await expectAccessible(page);

    await question.getByRole('radio', { name: 'Tous les membres de l’agenda' }).check();
    await expectAccessible(page);
    await capture(page, 'session-question');
    await question.getByRole('button', { name: 'Répondre' }).click();

    await expect(panel(page)).toContainText('Tu as répondu : Tous les membres de l’agenda');
    await expect(panel(page)).toContainText('Noté : « Tous les membres de l’agenda ».');
    await expect(panel(page).locator('cd-question')).toHaveCount(0);
    await expect(composer(page, 'Écrire à l’agent, ou dicter')).toBeVisible();
    await expect(row(page, 'Question de l’agent')).toHaveCount(0);
  });

  test('a question answered with the Pilote’s own words, typed in the Composer', async ({ page, scenario }) => {
    await scenario('session-question');
    await expect(panel(page).locator('cd-question')).toContainText(QUESTION);

    const field = composer(page, 'Ou réponds avec tes mots');
    await field.fill('Les membres invités par l’auteur');
    await field.press('Enter');
    await expect(panel(page)).toContainText('Tu as répondu : Les membres invités par l’auteur');
    await expect(panel(page)).toContainText('Noté : « Les membres invités par l’auteur ».');
    await expect(panel(page).locator('cd-question')).toHaveCount(0);
    await expect(row(page, 'Question de l’agent')).toHaveCount(0);
  });

  test('a permission: its tool and command, each of its three buttons reaches the Moteur', async ({ page, scenario, expectAccessible, capture }) => {
    for (const [button, said] of [
      ['Autoriser', 'Autorisé'],
      ['Autoriser pour la session', 'Autorisé pour la session'],
      ['Refuser', 'Refusé'],
    ] as const) {
      await scenario('session-permission');
      const request = panel(page).locator('cd-permission-request');
      await expect(request).toContainText('Bash demande ta permission');
      await expect(request).toContainText('git push origin design/agenda-partage');
      await expect(row(page, 'Concevoir · Agenda partagé')).toContainText('Bash : git push origin design/agenda-partage');
      if (button === 'Autoriser') {
        await expectAccessible(page);
        await capture(page, 'session-permission');
      }

      await request.getByRole('button', { name: button, exact: true }).click();
      await expect(panel(page).locator('cd-permission-request')).toHaveCount(0);
      await expect(panel(page)).toContainText(said);
      if (button === 'Autoriser') await expect(panel(page)).not.toContainText('Autorisé pour la session');
      await expect(row(page, 'Concevoir · Agenda partagé')).toHaveCount(0);
    }
  });

  test('the Runner offline: the Décision says to open the Session, its text not read', async ({ page, scenario }) => {
    await scenario('session-question');
    await expect(row(page, 'Question de l’agent')).toContainText(QUESTION);

    await post(page, '/api/testing/runner/disconnect');
    await expect(row(page, 'Question de l’agent')).toContainText('Ouvre la Session pour lire la question.');
    await expect(row(page, 'Question de l’agent')).not.toContainText(QUESTION);
  });
});

