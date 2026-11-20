import type { Page, Request } from '@playwright/test';
import { expect, test } from './fixtures.js';

const ideePage = (page: Page) => page.locator('cd-page-idee');
const analysisCard = (page: Page) => page.locator('cd-page-idee cd-idea-analysis');
const aside = (page: Page) => page.locator('cd-page-idees > cd-idea-analysis[slot="aside"]');
const row = (page: Page, number: number) => page.locator('cd-page-idees cd-idea-row').filter({ hasText: `#${number} ·` });
/** The command `POST /api/ideas/<id>/<command>` the page sends next. */
const command = (page: Page, name: 'target' | 'reanalyse'): Promise<Request> =>
  page.waitForRequest((request) => request.method() === 'POST' && new RegExp(`/api/ideas/[0-9a-f-]{36}/${name}$`).test(new URL(request.url()).pathname));

/** US-6: an Idée's page, its text noted, its analysis (summary, Projet visé, impact, effort, Rôle and Moteur), its possible duplicates. */
test('« Une Idée » shows #63 noted, analysed in Personal OS with its reasons, #58 a possible duplicate, accessible; « Changer » posts the Projet visé', async ({
  page,
  scenario,
  expectAccessible,
}) => {
  await scenario('idee');
  await expect(page).toHaveURL(/\/idees\/[0-9a-f-]{36}$/);
  await expect(ideePage(page).locator('cd-page-header')).toContainText('Exporter le planning en PDF pour le client');
  await expect(ideePage(page).locator('cd-page-header')).toContainText('#63 · Analysée');
  await expect(ideePage(page).locator('cd-card.noted')).toContainText('« Exporter le planning en PDF pour le client');
  await expect(ideePage(page).locator('cd-card.noted')).toContainText(/par toi · au PC · il y a (2 h|1 h)/);

  const analysis = analysisCard(page);
  await expect(analysis).toContainText('Analyse');
  await expect(analysis).toContainText('Un bouton dans le planning de Personal OS qui produit la semaine affichée en PDF');
  await expect(analysis.locator('.target')).toHaveText('Personal OS');
  await expect(analysis.locator('.impact')).toHaveText('moyen : le client le demande à chaque fin de semaine');
  await expect(analysis.locator('.effort')).toHaveText('faible : le planning existe déjà, seul l’export manque');
  await expect(analysis.locator('.run')).toContainText('Rôle Idée · Claude Code · il y a');

  const duplicates = ideePage(page).locator('cd-card.duplicates');
  await expect(duplicates).toContainText('Doublons possibles');
  await expect(duplicates.locator('cd-list-row')).toHaveCount(1);
  await expect(duplicates.locator('cd-list-row')).toContainText('#58 Imprimer le planning de la semaine');
  await expect(duplicates.locator('cd-list-row')).toContainText('Personal OS · retenue ·');
  await expectAccessible(page);

  // « Changer » opens the Menu of the Pilote's Projets and « nouveau »; choosing posts the Projet visé, `null` for « nouveau ».
  await analysis.getByRole('button', { name: /Changer/ }).click();
  const menu = analysis.locator('cd-menu');
  await expect(menu.getByRole('menuitem', { name: /Personal OS/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Crewdeck/ })).toBeVisible();
  await expectAccessible(page);
  const posted = command(page, 'target');
  await menu.getByRole('menuitem', { name: /nouveau/ }).click();
  expect((await posted).postDataJSON()).toMatchObject({ projectId: null, seq: expect.any(String) });
  await expect(analysis.locator('.target')).toHaveText('nouveau');
  await expect(menu).toHaveCount(0);
});

/** US-6: an analysis whose Contrat was not met says so on its row and beside the list, and runs again on « Relancer l’analyse ». */
test('« Idées », #64’s analysis failed: its row says so, the aside names the rules not met and the Rôle, accessible; « Relancer l’analyse » posts', async ({
  page,
  scenario,
  expectAccessible,
}) => {
  await scenario('idees-analyse-echouee');
  await expect(page).toHaveURL(/\/idees\?idee=[0-9a-f-]{36}$/);
  await expect(page.locator('cd-page-idees cd-idea-row')).toHaveCount(4);

  const failed = row(page, 64);
  await expect(failed).toContainText('Prévenir quand une Planification démarre la Boucle');
  await expect(failed).toContainText('L’analyse a échoué : son Contrat n’est pas rempli.');
  await expect(failed).toContainText('Analyse échouée');
  await expect(failed.getByRole('button', { name: 'Relancer l’analyse' })).toBeVisible();
  // The others, analysed: titled by their analysis, their impact and effort in a word, #63 a possible duplicate of #58.
  await expect(row(page, 63)).toContainText('Exporter le planning en PDF pour le client');
  await expect(row(page, 63)).toContainText('doublon possible : #58');
  await expect(row(page, 62)).toContainText('La date des actualités s’affiche en anglais sur le téléphone.');

  const preview = aside(page);
  await expect(preview).toContainText('Analyse · #64');
  await expect(preview).toContainText('Prévenir quand une Planification démarre la Boucle');
  await expect(preview).toContainText('Analyse échouée');
  await expect(preview).toContainText('L’analyse n’a pas rendu ce que son Contrat demande');
  await expect(preview.locator('.rules li')).toHaveText([
    'Le rapport a un titre et un résumé d’au plus 400 caractères',
    'L’impact et l’effort vont de 1 à 5, chacun avec sa raison',
  ]);
  await expect(preview).toContainText('Une Décision « Contrat incomplet » t’attend aussi dans « À toi ».');
  await expect(preview.locator('.run')).toContainText('Rôle Idée · Claude Code · il y a 4 min');
  // The aside from 1280 px only: a phone opens the Idée's own page.
  const wide = (test.info().project.use.viewport?.width ?? 0) >= 1280;
  if (wide) await expect(preview).toBeInViewport();
  else await expect(preview).toBeHidden();
  await expectAccessible(page);

  // From the aside, then from the row: each posts the command, nothing more than its `seq`.
  if (wide) {
    const fromAside = command(page, 'reanalyse');
    await preview.getByRole('button', { name: 'Relancer l’analyse' }).click();
    expect(Object.keys((await fromAside).postDataJSON() as object)).toEqual(['seq']);
  }
  const fromRow = command(page, 'reanalyse');
  await failed.getByRole('button', { name: 'Relancer l’analyse' }).click();
  expect(Object.keys((await fromRow).postDataJSON() as object)).toEqual(['seq']);
});

/** US-6: an Idée noted runs its analysis; the fake Runner's recorded report makes it « Analysée », in clear, within 2 s. */
test('« Noter une Idée » with the Runner online: the analysis runs, the row « Analysée » with its summary within 2 s, accessible', async ({
  page,
  scenario,
  expectAccessible,
}) => {
  await scenario('idees-analyse');
  await expect(page.locator('cd-page-idees cd-idea-row')).toHaveCount(4);
  await page.locator('cd-page-idees cd-page-header').getByRole('button', { name: 'Noter une Idée' }).click();
  await page.locator('cd-note-idea-dialog').getByRole('textbox', { name: 'Ton Idée, en une phrase' }).fill('Exporter les factures pour la comptable');
  await page.locator('cd-note-idea-dialog').getByRole('button', { name: 'Noter', exact: true }).click();

  const noted = row(page, 65);
  await expect(noted).toContainText('Analysée', { timeout: 2_000 });
  await expect(noted).toContainText('Export CSV des factures');
  if ((test.info().project.use.viewport?.width ?? 0) >= 1280) {
    await expect(noted).toContainText('Exporter les factures du mois en CSV pour la comptable');
    await expect(noted).toContainText('Impact fort');
    await expect(noted).toContainText('Effort faible');
  }
  await expectAccessible(page);
});
