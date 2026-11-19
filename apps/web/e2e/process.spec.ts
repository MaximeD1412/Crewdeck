import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const editor = (page: Page) => page.locator('cd-page-process-editor');
const canvas = (page: Page) => editor(page).locator('cd-process-canvas');
const card = (page: Page, stepId: string) => canvas(page).locator(`cd-step-card[data-step="${stepId}"]`);
const panel = (page: Page) => editor(page).getByRole('tabpanel');
const tab = (page: Page, name: RegExp) => editor(page).getByRole('tab', { name });
const gapRows = (page: Page) => panel(page).locator('button.gap');

/** Where a block's centre lies from its canvas's viewport's, in px. */
const offCentre = async (block: Locator, viewport: Locator): Promise<number> => {
  const [a, b] = await Promise.all([block.boundingBox(), viewport.boundingBox()]);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
};

/** « Process Crewdeck » as `PROCESS_CREWDECK` defines it (a spec cannot import the contracts' unbuilt `dist/`). */
const CREWDECK = { phases: 3, steps: 17, arrows: 25, loopBacks: 8 };

interface Definition {
  steps: { id: string; name: string }[];
}

/** US-92, US-94, US-88: « Gestion du process » read at 1280 px (the phone's list is PROCESS-11's). */
test.describe('« Gestion du process » (US-92, US-94, US-88)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, 'the editor: 1280 px');

  test('the active version of « Process Crewdeck »: the compact Cadre, the header, every Phase, Étape, arrow and Retour, « Aucun Manque »', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('process');

    await expect(page.locator('#app > cd-cadre')).toHaveJSProperty('data.variant', 'compact');
    await expect(editor(page).getByRole('heading', { level: 1, name: 'Gestion du process' })).toBeVisible();
    await expect(editor(page).locator('cd-page-header a.back')).toHaveText('Site mairie');
    await expect(editor(page).locator('cd-page-header')).toContainText('v3 active');
    await expect(canvas(page).locator('cd-phase')).toHaveCount(CREWDECK.phases);
    await expect(canvas(page).locator('cd-step-card')).toHaveCount(CREWDECK.steps);
    await expect(canvas(page).locator('path.wire.arrow')).toHaveCount(CREWDECK.arrows);
    await expect(canvas(page).locator('cd-loop-back')).toHaveCount(CREWDECK.loopBacks);
    await expect(card(page, 'st-analyse')).toContainText('idea-analysis');
    await expect(card(page, 'st-checks')).toContainText('GitHub');
    await expect(tab(page, /^Manques/)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page)).toContainText('Aucun Manque');
    await expect(editor(page).locator('footer.foot')).toContainText('v3 active depuis le 4 nov.');
    await expectAccessible(page);
  });

  test('a draft and its five Manques: listed, counted, the unfed Entrée marked; one chosen selects and centres its block, the URL keeps it', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('process-manques');

    await expect(editor(page).locator('cd-page-header')).toContainText('brouillon · 5 Manques');
    await expect(tab(page, /^Manques/)).toHaveText('Manques5');
    await expect(gapRows(page)).toHaveCount(5);
    await expect(gapRows(page).nth(1)).toContainText('Entrée « Verdict de la Review » de « Merge » : rien ne l’alimente');
    await expect(gapRows(page).nth(1)).toContainText('Merge · Développement');
    await expect(card(page, 'st-e2e')).toContainText('Tests de bout en bout');
    await expect(card(page, 'st-merge').locator('.port.unfed')).toHaveCount(1);
    await expectAccessible(page);

    await gapRows(page).nth(4).click();
    await expect(page).toHaveURL(/\?etape=st-e2e$/);
    await expect(tab(page, /^Étape/)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page)).toContainText('Tests de bout en bout');
    await expect.poll(() => offCentre(card(page, 'st-e2e'), canvas(page).locator('.canvas'))).toBeLessThan(4);

    await page.reload();
    await expect(tab(page, /^Étape/)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page)).toContainText('Tests de bout en bout');
  });

  test('the Review chosen: its kind and Phase, its Retour, its Entrées and Sortie, its Outils', async ({ page, scenario, expectAccessible }) => {
    await scenario('process-etape');

    await expect(tab(page, /^Étape/)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page).locator('.kind')).toHaveText('Agent · Développement');
    await expect(panel(page).locator('section.loop-back')).toContainText(/Vers « Code ».*3 fois au plus/);
    const ports = panel(page).locator('details.ports');
    await expect(ports.locator('summary')).toContainText('2 → 1');
    await ports.locator('summary').click();
    await expect(ports.locator('.item')).toHaveText([/Changement de code\s*← Code/, /Verdict des checks\s*← Checks/, /Verdict\s*→ Merge/]);
    await expect(panel(page).locator('section.tools .item')).toHaveText([/Rôle Review\s*Claude Code · Opus 5.5/, /Skill review\s*officielle/]);
    await expectAccessible(page);
  });

  test('a block centred once: the canvas moved, the page left and come back to, it stays where the Pilote left it', async ({ page, scenario }) => {
    await scenario('process-etape');
    const viewport = canvas(page).locator('.canvas');
    await expect.poll(() => offCentre(card(page, 'st-review'), viewport)).toBeLessThan(4);

    await viewport.focus();
    for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowUp']) await viewport.press(key);
    const moved = await offCentre(card(page, 'st-review'), viewport);
    expect(moved).toBeGreaterThan(100);

    await editor(page).locator('cd-page-header a.back').click();
    await expect(editor(page)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\?etape=st-review$/);
    await expect(card(page, 'st-review')).toBeVisible();
    await page.waitForTimeout(300);
    expect(Math.abs((await offCentre(card(page, 'st-review'), viewport)) - moved)).toBeLessThan(4);
  });

  test('a Phase chosen: « Répéter » on « Pour chaque Ticket prêt », its help', async ({ page, scenario }) => {
    await scenario('process');
    await page.goto(`${new URL(page.url()).pathname}?phase=ph-dev`);

    await expect(panel(page).getByRole('radio', { name: 'Pour chaque Ticket prêt' })).toBeChecked();
    await expect(panel(page).locator('section.repeat .help')).toHaveText('Chaque Ticket prêt parcourt la Phase : c’est la Boucle.');
  });

  test('« Sources »: the Tickets Local on the Runner’s machine, the code and documents on GitHub, the Idée in Crewdeck, no Select', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('process-sources');

    await expect(tab(page, /^Sources/)).toHaveAttribute('aria-selected', 'true');
    const rows = panel(page).locator('.item');
    await expect(rows).toHaveText([
      /Tickets\s*Local\s*dossier tickets\/ du Projet, sur atelier-pc/,
      /Code et documents\s*GitHub\s*octocat\/site-mairie · Changement de code, Verdict, PRD, Maquettes, Conception technique ; Inventaire non utilisé/,
      /Idée\s*Crewdeck/,
    ]);
    await expect(panel(page).locator('cd-select, select')).toHaveCount(0);
    await expectAccessible(page);
  });

  test('a Local Projet: its draft’s Phase « Livraison » and its Commande « Lancer » chosen; Local for both groups, no GitHub', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('process-local');

    await expect(editor(page).locator('cd-page-header a.back')).toHaveText('Recettes');
    await expect(canvas(page).locator('cd-phase[data-phase="ph-livraison"]')).toContainText('Livraison');
    await expect(panel(page).locator('.kind')).toHaveText('Commande · Livraison');
    await expect(card(page, 'st-lancer')).toHaveJSProperty('data.selected', true);
    await expect(canvas(page)).not.toContainText('GitHub');
    await expectAccessible(page);

    await tab(page, /^Sources/).click();
    await expect(page).toHaveURL(/onglet=sources/);
    await expect(panel(page).locator('.item')).toHaveText([/Tickets\s*Local/, /Code et documents\s*Local/, /Idée\s*Crewdeck/, /Livraison\s*aucune Source/]);
    await expect(panel(page)).not.toContainText('GitHub');
  });

  test('a Projet without an active version: its draft, its Manque, the Banner, « Ce brouillon deviendra la v1. »', async ({ page, scenario, expectAccessible }) => {
    await scenario('process-sans-version');

    await expect(editor(page).locator('cd-banner')).toContainText('Pas encore de version active : règle les Manques puis active.');
    await expect(editor(page).locator('cd-page-header')).toContainText('brouillon · pas encore de version active');
    await expect(gapRows(page)).toHaveCount(1);
    await expect(editor(page).locator('footer.foot')).toContainText('Ce brouillon deviendra la v1.');
    await expectAccessible(page);
  });

  test('another tab’s draft saved: the canvas shows it without a reload', async ({ page, scenario, baseURL }) => {
    const run = await scenario('process');
    await expect(card(page, 'st-review')).toContainText('Review');
    const projectId = /\/projets\/([^/]+)\/process/.exec(run.path)?.[1];

    const read = await page.request.get(`/api/projects/${projectId ?? ''}/process`);
    const { definition } = ((await read.json()) as { active: { definition: Definition } }).active;
    const review = definition.steps.find((step) => step.id === 'st-review');
    if (!review || !projectId) throw new Error('no Review, or no Projet in the path');
    review.name = 'Relecture';
    const origin = new URL(baseURL ?? 'http://localhost:4200').origin;
    const saved = await page.request.put(`/api/projects/${projectId}/process/draft`, {
      data: { definition, sealed: null, revision: 0, baseVersion: 3 },
      headers: { origin },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    await expect(card(page, 'st-review')).toContainText('Relecture', { timeout: 2_000 });
    await expect(editor(page).locator('cd-page-header')).toContainText('brouillon');
  });

  test('a Projet the Pilote has not: « Ce Projet n’existe pas » and the way back to the Projets', async ({ page, scenario, expectAccessible }) => {
    await scenario('process');
    await page.goto('/projets/019a7000-0000-7000-8000-00000000dead/process');

    await expect(editor(page)).toContainText('Ce Projet n’existe pas');
    await expect(editor(page).getByRole('link', { name: 'Retour aux Projets' })).toHaveAttribute('href', '/projets');
    await expect(canvas(page)).toHaveCount(0);
    await expectAccessible(page);
  });
});
