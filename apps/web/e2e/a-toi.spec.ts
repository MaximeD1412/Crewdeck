import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const ROWS = 'cd-page-a-toi cd-decision-row';
const rows = (page: Page) => page.locator(ROWS);
/** Each row's kind and title, then its meta, in the order shown. */
const listed = (page: Page) =>
  page.locator(ROWS).evaluateAll((elements) =>
    elements.map((row) =>
      ['.open', '.meta'].map((part) => (row.shadowRoot?.querySelector(part) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
    ),
  );
const chip = (page: Page, name: string) => page.locator('cd-page-a-toi cd-project-filter').getByRole('button', { name: new RegExp(`^${name}`) });
const count = (page: Page) => page.locator('cd-page-a-toi cd-page-header').locator('.count');
/** The count the Cadre's entry « À toi » shows, at the sidebar's side at 1280, its tab's badge at 390. */
const aToiEntry = (page: Page) => page.locator('#app > cd-cadre > cd-menu-item').first();

/** From the page: its Origin, as a page's POST carries it. */
const post = async (page: Page, path: string, data: unknown) => {
  const response = await page.request.post(path, { data, headers: { origin: new URL(page.url()).origin } });
  expect(response.status(), await response.text()).toBeLessThan(300);
};

const RAISED = {
  kind: 'ticket-blocked',
  projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01',
  projectName: 'Crewdeck',
  subjectType: 'ticket',
  subjectId: '42',
  label: '#42 Connexion GitHub',
  metaParts: ['Code'],
  tone: 'halt',
  link: '/boucle?ticket=42',
  params: {},
};

/** US-17: every Décision that waits for the Pilote is in « À toi ». */
test('« À toi » lists the nine open Décisions newest first, the Cadre counting them, and the chips filter by Projet, accessible', async ({
  page,
  scenario,
  expectAccessible,
  viewport,
}) => {
  await scenario('a-toi');
  await expect(count(page)).toHaveText('9 Décisions');
  await expect(rows(page)).toHaveCount(9);
  expect(await listed(page)).toEqual([
    'Permission demandée · Code · #44 Liste des Projets | Crewdeck · session · il y a 2 min',
    'Question de l’agent · Concevoir · Agenda partagé | Personal OS · session · il y a 3 min',
    'Ticket bloqué · #42 Connexion GitHub | Crewdeck · Code · il y a 4 min',
    'Limite atteinte · Claude · fenêtre de 5 h | Personal OS · #51 arrêté · il y a 12 min',
    'Revue visuelle · #38 Page Planning | Personal OS · 4 captures · il y a 20 min',
    'Conception à relire · PRD « Agenda partagé » | Personal OS · Conception · il y a 1 h',
    'Ticket interrompu · #47 Actualités en page d’accueil | Site mairie · Code · il y a 2 h',
    'Inventaire à approuver · Tennis Manager | Tennis Manager · Projet existant · il y a 3 h',
    'Contrat incomplet · Découpage « Actualités » | Site mairie · Tickets · hier',
  ]);
  await expect(aToiEntry(page)).toContainText('9');
  await expectAccessible(page);

  await expect(chip(page, 'Tous les Projets')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Personal OS')).toContainText('4');
  await chip(page, 'Personal OS').click();
  await expect(page).toHaveURL(/\/a-toi\?projet=019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02$/);
  await expect(rows(page)).toHaveCount(4);
  await expect(chip(page, 'Personal OS')).toHaveAttribute('aria-pressed', 'true');
  await expect(count(page)).toHaveText('9 Décisions');
  await chip(page, 'Tous les Projets').click();
  await expect(page).toHaveURL(/\/a-toi$/);
  await expect(rows(page)).toHaveCount(9);

  // The row leads to its Décision's page; from 1280 px, its « Ouvrir » too (below, the row is the button).
  await rows(page).first().getByRole('button', { name: /^Permission demandée/ }).click();
  await expect(page).toHaveURL(/\/boucle\?ticket=44$/);
  if ((viewport?.width ?? 0) >= 1280) {
    await page.goBack();
    await rows(page).nth(1).getByRole('button', { name: 'Ouvrir' }).click();
    await expect(page).toHaveURL(/\/conceptions$/);
  }
});

test('« Rien ne t’attend » with nothing waiting; a Décision raised shows without a reload, and leaves once resolved', async ({
  page,
  scenario,
  expectAccessible,
}) => {
  await scenario('a-toi-vide');
  await expect(page.getByText('Rien ne t’attend')).toBeVisible();
  await expect(count(page)).toHaveText('0 Décision');
  await expect(rows(page)).toHaveCount(0);
  await expectAccessible(page);
  const loads: string[] = [];
  page.on('load', () => loads.push(page.url()));

  await post(page, '/api/testing/decisions', RAISED);
  await expect(rows(page)).toHaveCount(1);
  await expect(count(page)).toHaveText('1 Décision');
  await expect(aToiEntry(page)).toContainText('1');
  await expect(page.getByText('Rien ne t’attend')).toHaveCount(0);

  await post(page, '/api/testing/decisions/resolve', { kind: 'ticket-blocked', subjectId: '42', outcome: 'answered' });
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('Rien ne t’attend')).toBeVisible();
  expect(loads).toEqual([]);
});
