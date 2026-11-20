import type { Page, Request } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { canvas, card, dragArrow, dragLoopBack, editor, port, seeAll } from './process-canvas.js';

const panel = (page: Page) => editor(page).getByRole('tabpanel');
const toast = (page: Page) => editor(page).locator('cd-toast');
const tab = (page: Page, name: RegExp) => editor(page).getByRole('tab', { name });
const ports = (page: Page) => panel(page).locator('details.ports');
const loopBack = (page: Page) => panel(page).locator('section.loop-back');
const tools = (page: Page) => panel(page).locator('section.tools');
const attachMenu = (page: Page, step: string) => editor(page).getByRole('menu', { name: `Attacher à « ${step} »` });

interface Ref {
  stepId: string;
  portId: string;
}
interface Definition {
  steps: { id: string; tools: Record<string, string>[] }[];
  arrows: { from: Ref; to: Ref }[];
  loopBacks: { from: string; to: string; max: number }[];
}
interface Shown {
  active: { definition: Definition } | null;
  draft: { revision: number; definition: Definition } | null;
}

const isDraftPut = (request: Request) => request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/process/draft');

/** Every draft PUT the page sends, in order. */
const draftPuts = (page: Page): unknown[] => {
  const sent: unknown[] = [];
  page.on('request', (request) => {
    if (isDraftPut(request)) sent.push(request.postDataJSON());
  });
  return sent;
};

const projectOf = (path: string): string => {
  const id = /\/projets\/([^/?]+)\/process/.exec(path)?.[1];
  if (!id) throw new Error(`no Projet in ${path}`);
  return id;
};

/** What the server keeps: the draft's definition, else the active version's. */
const definitionOf = async (page: Page, projectId: string): Promise<Definition> => {
  const response = await page.request.get(`/api/projects/${projectId}/process`);
  expect(response.status()).toBe(200);
  const shown = (await response.json()) as Shown;
  const definition = shown.draft?.definition ?? shown.active?.definition;
  if (!definition) throw new Error('no definition');
  return definition;
};
const revisionOf = async (page: Page, projectId: string) => {
  const response = await page.request.get(`/api/projects/${projectId}/process`);
  return ((await response.json()) as Shown).draft?.revision ?? 0;
};
const hasArrow = (definition: Definition, from: Ref, to: Ref) =>
  definition.arrows.some(
    (arrow) => arrow.from.stepId === from.stepId && arrow.from.portId === from.portId && arrow.to.stepId === to.stepId && arrow.to.portId === to.portId,
  );

/** The Étape chosen through the URL, the canvas drawn, its Entrées and Sorties unfolded. */
const choose = async (page: Page, stepId: string) => {
  await page.goto(`${new URL(page.url()).pathname}?etape=${stepId}`);
  await expect(card(page, stepId)).toBeVisible();
  await ports(page).locator('summary').click();
};

const CODE_OUT = { stepId: 'st-code', portId: 'changement' };

/** US-94, US-95, US-93, US-73: arrows, Retours and Outils on « Gestion du process »'s canvas at 1280 px. */
test.describe('« Gestion du process »: arrows, Retours and Outils (US-93, US-94, US-95, US-73)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, 'the editor: 1280 px');

  test('« Code »’s Sortie onto « Revue visuelle »’s Maquettes: drawn refused, « Refusée : … », nothing saved; onto an unfed Changement de code: added and saved', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    const run = await scenario('process-fleche-refusee');
    const projectId = projectOf(run.path);
    const puts = draftPuts(page);
    await expect(card(page, 'st-rv')).toBeVisible();
    await seeAll(page);

    await dragArrow(page, CODE_OUT, { stepId: 'st-rv', portId: 'maquettes' });
    await expect(toast(page)).toHaveText('Refusée : une Sortie Changement de code ne va que vers une Entrée Changement de code');
    await expect(canvas(page).locator('path.wire.arrow.refused[data-from="st-code.changement"]')).toHaveCount(1);
    await expectAccessible(page);
    expect(puts).toHaveLength(0);

    // Its Retour to « Code » first: without the arrow, « Code » would no longer come before it.
    await choose(page, 'st-rv');
    await loopBack(page).getByRole('button', { name: 'Retirer le Retour' }).click();
    await expect.poll(() => revisionOf(page, projectId)).toBe(1);
    await ports(page).getByRole('button', { name: 'Retirer la flèche de « Code »' }).click();
    await expect.poll(() => revisionOf(page, projectId)).toBe(2);
    expect(hasArrow(await definitionOf(page, projectId), CODE_OUT, { stepId: 'st-rv', portId: 'changement' })).toBe(false);

    await seeAll(page);
    await dragArrow(page, CODE_OUT, { stepId: 'st-rv', portId: 'changement' });
    await expect.poll(() => revisionOf(page, projectId)).toBe(3);
    expect(hasArrow(await definitionOf(page, projectId), CODE_OUT, { stepId: 'st-rv', portId: 'changement' })).toBe(true);
    await expect(ports(page).getByRole('button', { name: 'Retirer la flèche de « Code »' })).toHaveCount(1);
  });

  test('a cycle and an Entrée already fed refused with their label; « Alimentée par » offers only what the rules accept; Review → Merge removed shows its Manques', async ({
    page,
    scenario,
  }) => {
    const run = await scenario('process');
    const projectId = projectOf(run.path);
    await choose(page, 'st-checks');
    await ports(page).getByRole('button', { name: 'Retirer la flèche de « Code »' }).click();
    await expect.poll(() => revisionOf(page, projectId)).toBe(1);

    await seeAll(page);
    await dragArrow(page, { stepId: 'st-merge', portId: 'changement' }, { stepId: 'st-checks', portId: 'changement' });
    await expect(toast(page)).toHaveText('Refusée : cette flèche ferait une boucle : une boucle n’existe que comme Retour, avec son maximum.');
    await dragArrow(page, { stepId: 'st-checks', portId: 'verdict' }, { stepId: 'st-merge', portId: 'v-rv' });
    await expect(toast(page)).toHaveText(/Refusée : l’Entrée « .+ » de « Merge » a déjà sa flèche/);
    expect(await revisionOf(page, projectId)).toBe(1);

    const fedBy = ports(page).getByRole('combobox', { name: 'Alimentée par' });
    await expect(fedBy.locator('option')).toHaveText(['Choisir une Sortie', 'Changement de code · Code']);
    await fedBy.selectOption({ label: 'Changement de code · Code' });
    await expect.poll(() => revisionOf(page, projectId)).toBe(2);
    expect(hasArrow(await definitionOf(page, projectId), CODE_OUT, { stepId: 'st-checks', portId: 'changement' })).toBe(true);
    await expect(fedBy).toHaveCount(0);

    await choose(page, 'st-review');
    await ports(page).getByRole('button', { name: 'Retirer la flèche vers « Merge »' }).click();
    await expect.poll(() => revisionOf(page, projectId)).toBe(3);
    await expect(port(page, 'st-merge', 'v-review', 'in')).toBeVisible();
    await tab(page, /^Manques/).click();
    // The Checks reached the Merge only through the Review: both guards are missing.
    await expect(tab(page, /^Manques/)).toHaveText('Manques3');
    await expect(panel(page)).toContainText('« Merge » merge un Changement de code sans Review avant lui');
    await expect(panel(page)).toContainText('« Merge » merge un Changement de code sans checks avant lui');
    await expect(panel(page)).toContainText(/Entrée « .+ » de « Merge » : rien ne l’alimente/);
  });

  test('a Retour: removed, dropped from the Review on « Code » with « 3 fois au plus », refused to another Phase; « Au plus » stops at 1 and 10, each change saved', async ({
    page,
    scenario,
  }) => {
    const run = await scenario('process-etape');
    const projectId = projectOf(run.path);
    const reviewLoop = async () => (await definitionOf(page, projectId)).loopBacks.find((loop) => loop.from === 'st-review');
    await expect(card(page, 'st-review')).toBeVisible();

    await loopBack(page).getByRole('button', { name: 'Retirer le Retour' }).click();
    await expect.poll(reviewLoop).toBeUndefined();
    await expect(loopBack(page).getByRole('combobox', { name: 'Poser un Retour vers' })).toBeVisible();

    await seeAll(page);
    await dragLoopBack(page, 'st-review', 'st-code');
    await expect(toast(page)).toHaveText('Retour de « Review » vers « Code », 3 fois au plus.');
    await expect.poll(reviewLoop).toEqual({ from: 'st-review', to: 'st-code', max: 3 });

    await dragLoopBack(page, 'st-review', 'st-prd');
    await expect(toast(page)).toHaveText(/Refusée : un Retour reste dans sa Phase/);
    await expect.poll(async () => (await reviewLoop())?.to).toBe('st-code');
    // « Code » does not judge: no handle on its card, nothing to pose in its panel.
    await expect(card(page, 'st-code').locator('.handle')).toHaveCount(0);

    const stepper = loopBack(page).locator('cd-stepper');
    await stepper.getByRole('button', { name: 'Moins' }).click();
    await expect(stepper.locator('output')).toHaveText('2 fois');
    await stepper.getByRole('button', { name: 'Moins' }).click();
    await expect(stepper.getByRole('button', { name: 'Moins' })).toBeDisabled();
    await expect(stepper.locator('output')).toHaveText('1 fois');
    await expect.poll(async () => (await reviewLoop())?.max).toBe(1);
    for (let step = 1; step < 10; step += 1) {
      await stepper.getByRole('button', { name: 'Plus' }).click();
      await expect(stepper.locator('output')).toHaveText(`${step + 1} fois`);
    }
    await expect(stepper.getByRole('button', { name: 'Plus' })).toBeDisabled();
    await expect.poll(async () => (await reviewLoop())?.max).toBe(10);

    await loopBack(page).getByRole('button', { name: 'Retirer le Retour' }).click();
    await expect.poll(reviewLoop).toBeUndefined();

    await choose(page, 'st-code');
    await expect(loopBack(page)).toHaveCount(0);
  });

  test('« Attacher un Outil » on the Review: its Rôle chosen, its Skill, the two Serveurs MCP and GitHub; « stitch » attached, another Rôle replaces the first', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    const run = await scenario('process-etape');
    const projectId = projectOf(run.path);
    await expect(card(page, 'st-review')).toBeVisible();

    await tools(page).getByRole('button', { name: 'Attacher un Outil' }).click();
    const menu = attachMenu(page, 'Review');
    await expect(menu.getByRole('group')).toHaveCount(4);
    const group = (name: RegExp) => menu.getByRole('group', { name });
    await expect(group(/^Rôle/).locator('.selected')).toContainText('Review');
    await expect(group(/^Skill/).getByRole('menuitem')).toContainText(['review']);
    await expect(group(/^Serveur MCP, déclaré sur atelier-pc/).getByRole('menuitem')).toHaveCount(3);
    await expect(group(/^Serveur MCP/).getByRole('menuitem').filter({ hasText: 'Déclarer un Serveur MCP' })).toHaveCount(1);
    await expect(group(/^Connecteur/).getByRole('menuitem')).toContainText(['GitHub']);
    await expectAccessible(page);

    await group(/^Serveur MCP/).getByRole('menuitem').filter({ hasText: 'stitch' }).click();
    await expect(menu).toHaveCount(0);
    await expect(tools(page).locator('.item').filter({ hasText: 'Serveur MCP stitch' })).toHaveCount(1);
    await expect(card(page, 'st-review').locator('cd-tool-chip').filter({ hasText: 'stitch' })).toHaveCount(1);
    await expect.poll(async () => (await definitionOf(page, projectId)).steps.find((step) => step.id === 'st-review')?.tools).toContainEqual({
      kind: 'mcp',
      name: 'stitch',
    });

    await tools(page).getByRole('button', { name: 'Attacher un Outil' }).click();
    await expect(group(/^Serveur MCP/).getByRole('menuitem').filter({ hasText: 'stitch' })).toHaveAttribute('aria-disabled', 'true');
    await group(/^Rôle/).locator('[data-id="role:code"]').click();
    await expect(tools(page).locator('.item b')).toHaveText(['Rôle Code', 'Skill review', 'Serveur MCP stitch']);
    await expect
      .poll(async () => (await definitionOf(page, projectId)).steps.find((step) => step.id === 'st-review')?.tools.filter((tool) => tool['kind'] === 'role'))
      .toEqual([{ kind: 'role', roleId: 'code' }]);
  });

  test('detaching the Review’s Rôle shows its Manque « a besoin … »', async ({ page, scenario }) => {
    await scenario('process-etape');
    await tools(page).getByRole('button', { name: 'Détacher le Rôle Review' }).click();
    await expect(tab(page, /^Manques/)).toHaveText('Manques1');
    await tab(page, /^Manques/).click();
    await expect(panel(page)).toContainText(/« Review » a besoin .+ : aucun Outil attaché n’en donne/);
  });

  test('with no Serveur MCP declared, only « Déclarer un Serveur MCP », which opens the Runner’s page', async ({ page, scenario }) => {
    await scenario('process');
    await page.goto(`${new URL(page.url()).pathname}?etape=st-review`);
    await tools(page).getByRole('button', { name: 'Attacher un Outil' }).click();
    const mcp = attachMenu(page, 'Review').getByRole('group', { name: /^Serveur MCP/ }).getByRole('menuitem');
    await expect(mcp).toHaveCount(1);
    await mcp.filter({ hasText: 'Déclarer un Serveur MCP' }).click();
    await expect(page).toHaveURL(/\/runner$/);
  });

  test('« Attacher un Outil » absent on a gate and on the Merge, there on the Checks', async ({ page, scenario }) => {
    await scenario('process');
    for (const [stepId, shown] of [
      ['st-ap-tickets', 0],
      ['st-merge', 0],
      ['st-checks', 1],
    ] as const) {
      await page.goto(`${new URL(page.url()).pathname}?etape=${stepId}`);
      await expect(card(page, stepId)).toBeVisible();
      await expect(tools(page).getByRole('button', { name: 'Attacher un Outil' })).toHaveCount(shown);
    }
  });

  test('on /runner, « attaché à aucune Étape », then « attaché à « Review » · Site mairie » once attached in the draft, without reload', async ({ page, scenario }) => {
    await scenario('process-etape');
    await expect(card(page, 'st-review')).toBeVisible();
    const runner = await page.context().newPage();
    await runner.goto('/runner');
    const row = (name: string) => runner.locator('cd-page-runner cd-card.mcp cd-list-row').filter({ hasText: name });
    await expect(row('stitch')).toContainText('stdio · 12 outils · attaché à aucune Étape');
    await expect(row('figma')).toContainText('attaché à aucune Étape');

    await tools(page).getByRole('button', { name: 'Attacher un Outil' }).click();
    await attachMenu(page, 'Review').getByRole('menuitem').filter({ hasText: 'stitch' }).click();
    await expect(row('stitch')).toContainText('stdio · 12 outils · attaché à « Review » · Site mairie');
    await expect(row('figma')).toContainText('attaché à aucune Étape');
  });
});
