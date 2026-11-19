import type { Page, Request, Route } from '@playwright/test';
import { expect, test } from './fixtures.js';

const editor = (page: Page) => page.locator('cd-page-process-editor');
const canvas = (page: Page) => editor(page).locator('cd-process-canvas');
const card = (page: Page, stepId: string) => canvas(page).locator(`cd-step-card[data-step="${stepId}"]`);
const inPhase = (page: Page, phaseId: string, stepId: string) => canvas(page).locator(`cd-phase[data-phase="${phaseId}"] cd-step-card[data-step="${stepId}"]`);
const panel = (page: Page) => editor(page).getByRole('tabpanel');
const header = (page: Page) => editor(page).locator('cd-page-header');
const toast = (page: Page) => editor(page).locator('cd-toast');
const headerButton = (page: Page, name: string) => header(page).getByRole('button', { name, exact: true });

/** « Process Crewdeck » as `PROCESS_CREWDECK` defines it (a spec cannot import the contracts' unbuilt `dist/`). */
const CREWDECK = { phases: 3, steps: 17, arrows: 25, loopBacks: 8 };

interface Step {
  id: string;
  name: string;
  kind: string;
  phaseId: string;
  col: number;
  row: number;
  inputs: unknown[];
  outputs: unknown[];
  tools: unknown[];
}
interface Definition {
  phases: { id: string; name: string; forEach: string | null }[];
  steps: Step[];
  arrows: unknown[];
  loopBacks: unknown[];
}
interface Shown {
  active: { number: number; definition: Definition } | null;
  draft: { revision: number; definition: Definition } | null;
}
interface DraftInput {
  definition: Definition;
  revision: number;
  baseVersion: number;
}

const isDraftPut = (request: Request) => request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/process/draft');

/** Every draft PUT the page sends, in order. */
const draftPuts = (page: Page): DraftInput[] => {
  const sent: DraftInput[] = [];
  page.on('request', (request) => {
    if (isDraftPut(request)) sent.push(request.postDataJSON() as DraftInput);
  });
  return sent;
};

const projectOf = (path: string): string => {
  const id = /\/projets\/([^/?]+)\/process/.exec(path)?.[1];
  if (!id) throw new Error(`no Projet in ${path}`);
  return id;
};

/** What the server keeps: the draft's definition, else the active version's. */
const stored = async (page: Page, projectId: string): Promise<Shown> => {
  const response = await page.request.get(`/api/projects/${projectId}/process`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Shown;
};
const definitionOf = async (page: Page, projectId: string): Promise<Definition> => {
  const shown = await stored(page, projectId);
  const definition = shown.draft?.definition ?? shown.active?.definition;
  if (!definition) throw new Error('no definition');
  return definition;
};
const stepOf = async (page: Page, projectId: string, stepId: string) => (await definitionOf(page, projectId)).steps.find((step) => step.id === stepId);

/** Drags a card by its centre onto `target`'s centre, past the canvas's 4 px threshold first, the whole Process in view. */
const dragCard = async (page: Page, stepId: string, target: (page: Page) => ReturnType<Page['locator']>) => {
  await canvas(page).getByRole('button', { name: 'Tout voir' }).click();
  // The view moves on the next frame.
  await page.waitForTimeout(200);
  const from = await card(page, stepId).boundingBox();
  if (!from) throw new Error(`no card ${stepId}`);
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 12, { steps: 3 });
  const to = await target(page).boundingBox();
  if (!to) throw new Error('no cell to drop on');
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
};

const goToSelection = async (page: Page, query: string) => {
  await page.goto(`${new URL(page.url()).pathname}?${query}`);
  await expect(card(page, 'st-code')).toBeVisible();
};

/** US-93, US-95: editing the Phases and Étapes of « Gestion du process » at 1280 px, each change saved in the draft. */
test.describe('« Gestion du process »: editing on the canvas (US-93, US-95)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, 'the editor: 1280 px');

  test('« Étape » opens the catalogue of « Développement », three groups, no Checks nor Merge; « Revue croisée » added at its next free cell, selected, saved once', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    const run = await scenario('process-catalogue');
    const puts = draftPuts(page);
    await expect(card(page, 'st-code')).toBeVisible();

    await headerButton(page, 'Étape').click();
    const menu = editor(page).getByRole('menu', { name: 'Ajouter dans « Développement »' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('group')).toHaveCount(3);
    await expect(menu.getByRole('menuitem', { name: /^(Checks|Merge)/ })).toHaveCount(0);
    await expectAccessible(page);

    await menu.getByRole('menuitem', { name: /^Revue croisée/ }).click();
    await expect(menu).toHaveCount(0);
    await expect(inPhase(page, 'ph-dev', 'st-cross-review')).toBeVisible();
    await expect(page).toHaveURL(/\?etape=st-cross-review$/);
    await expect(panel(page)).toContainText('Revue croisée');
    await expect(header(page)).toContainText('brouillon');

    const projectId = projectOf(run.path);
    await expect.poll(async () => (await stored(page, projectId)).draft?.revision).toBe(1);
    const added = await stepOf(page, projectId, 'st-cross-review');
    expect(added).toMatchObject({ kind: 'cross-review', phaseId: 'ph-dev', col: 5, row: 1 });
    expect(added?.inputs.length).toBeGreaterThan(0);
    expect(added?.outputs.length).toBeGreaterThan(0);
    expect(added?.tools.length).toBeGreaterThan(0);
    expect(puts).toHaveLength(1);
  });

  test('« Retirer » on the Review, the Checks and the Merge disabled with its reason; on « Développement », « Elle tient la Review et le Merge… »', async ({
    page,
    scenario,
  }) => {
    await scenario('process');
    const reasons: [string, string][] = [
      ['st-review', 'La Review ne se retire pas : son Rôle se change.'],
      ['st-checks', 'Les Checks ne se retirent pas : leurs Outils se changent.'],
      ['st-merge', 'Le Merge ne se retire pas : c’est une Étape du produit.'],
    ];
    for (const [stepId, reason] of reasons) {
      await goToSelection(page, `etape=${stepId}`);
      await expect(panel(page).getByRole('button', { name: 'Retirer', exact: true })).toBeDisabled();
      await expect(panel(page)).toContainText(reason);
    }

    await goToSelection(page, 'phase=ph-dev');
    await expect(panel(page).getByRole('button', { name: 'Retirer la Phase' })).toBeDisabled();
    await expect(panel(page).locator('cd-button.remove-phase')).toContainText('Elle tient la Review et le Merge, qui ne se retirent pas.');
  });

  test('removing an Étape removes its arrows and Retours, in one save, the selection gone', async ({ page, scenario }) => {
    const run = await scenario('process');
    const puts = draftPuts(page);
    await goToSelection(page, 'etape=st-code');

    await panel(page).getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect(card(page, 'st-code')).toHaveCount(0);
    await expect(page).not.toHaveURL(/etape=/);
    // Its 5 arrows (from the Validation des Tickets, to the Checks, the Review, the Revue visuelle, the Merge) and its 2 Retours.
    await expect(canvas(page).locator('cd-step-card')).toHaveCount(CREWDECK.steps - 1);
    await expect(canvas(page).locator('path.wire.arrow')).toHaveCount(CREWDECK.arrows - 5);
    await expect(canvas(page).locator('cd-loop-back')).toHaveCount(CREWDECK.loopBacks - 2);

    const projectId = projectOf(run.path);
    await expect.poll(async () => (await stored(page, projectId)).draft?.definition.steps.length).toBe(CREWDECK.steps - 1);
    const saved = await definitionOf(page, projectId);
    expect(saved.arrows).toHaveLength(CREWDECK.arrows - 5);
    expect(saved.loopBacks).toHaveLength(CREWDECK.loopBacks - 2);
    expect(puts).toHaveLength(1);
  });

  test('removing a Phase with Étapes asks the Dialog listing them; « Annuler » changes nothing; « Retirer la Phase » removes them in one save', async ({
    page,
    scenario,
  }) => {
    const run = await scenario('process');
    const puts = draftPuts(page);
    await goToSelection(page, 'phase=ph-idee');

    const dialog = editor(page).locator('cd-dialog.remove-phase-dialog');
    await panel(page).getByRole('button', { name: 'Retirer la Phase' }).click();
    await expect(dialog.getByRole('dialog', { name: 'Retirer la Phase « Idée » ?' })).toBeVisible();
    await expect(dialog).toContainText('Ses 2 Étapes partent avec elle : Analyse de l’Idée, Tri de l’Idée.');
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog.getByRole('dialog')).toBeHidden();
    await expect(canvas(page).locator('cd-phase')).toHaveCount(CREWDECK.phases);
    expect(puts).toHaveLength(0);

    await panel(page).getByRole('button', { name: 'Retirer la Phase' }).click();
    await dialog.getByRole('button', { name: 'Retirer la Phase' }).click();
    await expect(dialog.getByRole('dialog')).toBeHidden();
    await expect(canvas(page).locator('cd-phase')).toHaveCount(CREWDECK.phases - 1);
    await expect(canvas(page).locator('cd-step-card')).toHaveCount(CREWDECK.steps - 2);

    const projectId = projectOf(run.path);
    await expect.poll(async () => (await stored(page, projectId)).draft?.definition.phases.length).toBe(CREWDECK.phases - 1);
    expect((await definitionOf(page, projectId)).steps).toHaveLength(CREWDECK.steps - 2);
    expect(puts).toHaveLength(1);
  });

  test('a card dragged on a free cell of another Phase moves there with its arrows', async ({ page, scenario }) => {
    const run = await scenario('process');
    await expect(card(page, 'st-tri')).toBeVisible();

    await dragCard(page, 'st-tri', (p) => canvas(p).locator('.cell[data-phase="ph-conception"][data-col="1"][data-row="3"]'));
    await expect(inPhase(page, 'ph-conception', 'st-tri')).toBeVisible();
    await expect(canvas(page).locator('path.wire.arrow')).toHaveCount(CREWDECK.arrows);

    const projectId = projectOf(run.path);
    await expect.poll(() => stepOf(page, projectId, 'st-tri')).toMatchObject({ phaseId: 'ph-conception', col: 1, row: 3 });
    expect((await definitionOf(page, projectId)).arrows).toHaveLength(CREWDECK.arrows);
  });

  test('a move the rules refuse: the Toast says why, nothing changes, nothing is saved', async ({ page, scenario }) => {
    const run = await scenario('process');
    const puts = draftPuts(page);
    await expect(card(page, 'st-code')).toBeVisible();

    // The Code's Retours come from the Review and the Revue visuelle, in « Développement ».
    await dragCard(page, 'st-code', (p) => canvas(p).locator('.cell[data-phase="ph-conception"][data-col="1"][data-row="3"]'));
    await expect(toast(page)).toContainText('Un Retour reste dans sa Phase');
    await expect(inPhase(page, 'ph-dev', 'st-code')).toBeVisible();
    expect(puts).toHaveLength(0);
    expect((await stored(page, projectOf(run.path))).draft).toBeNull();
  });

  test('the Phase Select moves an Étape to that Phase’s next free cell', async ({ page, scenario }) => {
    const run = await scenario('process');
    await goToSelection(page, 'etape=st-analyse');

    await panel(page).getByRole('combobox', { name: 'Phase' }).selectOption({ label: 'Conception' });
    await expect(inPhase(page, 'ph-conception', 'st-analyse')).toBeVisible();
    await expect.poll(() => stepOf(page, projectOf(run.path), 'st-analyse')).toMatchObject({ phaseId: 'ph-conception', col: 1, row: 3 });
  });

  test('« Phase » adds « Nouvelle Phase » under the others, selected, its name focused; an existing name refused; « Pour chaque Ticket prêt » its help and rail', async ({
    page,
    scenario,
  }) => {
    const run = await scenario('process');
    await expect(card(page, 'st-code')).toBeVisible();

    await headerButton(page, 'Phase').click();
    await expect(page).toHaveURL(/\?phase=ph-1$/);
    const phase = canvas(page).locator('cd-phase[data-phase="ph-1"]');
    await expect(phase).toContainText('Nouvelle Phase');
    const name = panel(page).getByRole('textbox', { name: 'Nom de la Phase' });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('Nouvelle Phase');

    await name.fill('Idée');
    await name.press('Enter');
    await expect(panel(page)).toContainText('Une Phase porte déjà ce nom.');
    await expect(phase).toContainText('Nouvelle Phase');

    // « Développement » repeats for each Ticket prêt: refused, the radio back on « Une fois ».
    await panel(page).getByRole('radio', { name: 'Pour chaque Ticket prêt' }).click();
    await expect(toast(page)).toContainText(/« Nouvelle Phase » se répète pour .*Ticket prêt, comme « Développement »/);
    await expect(panel(page).getByRole('radio', { name: 'Une fois' })).toBeChecked();

    await goToSelection(page, 'phase=ph-dev');
    await panel(page).getByRole('radio', { name: 'Une fois' }).check();
    await expect(canvas(page).locator('cd-phase[data-phase="ph-dev"] section.repeated')).toHaveCount(0);
    await goToSelection(page, 'phase=ph-1');
    await panel(page).getByRole('radio', { name: 'Pour chaque Ticket prêt' }).check();
    await expect(panel(page).locator('section.repeat .help')).toHaveText('Chaque Ticket prêt parcourt la Phase : c’est la Boucle.');
    await expect(phase.locator('section.repeated')).toContainText('pour chaque Ticket prêt');

    const projectId = projectOf(run.path);
    await expect
      .poll(async () => (await definitionOf(page, projectId)).phases.find((candidate) => candidate.id === 'ph-1'))
      .toMatchObject({ name: 'Nouvelle Phase', forEach: 'ticket.ready' });
  });

  test('three edits made during one save go together in the next PUT, on the revision it gave', async ({ page, scenario }) => {
    const run = await scenario('process-phase');
    await expect(card(page, 'st-code')).toBeVisible();
    const puts = draftPuts(page);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    await page.route('**/api/projects/*/process/draft', async (route: Route) => {
      if (first) {
        first = false;
        await held;
      }
      await route.continue();
    });

    await panel(page).getByRole('radio', { name: 'Une fois' }).check();
    await panel(page).getByRole('radio', { name: 'Pour chaque Ticket prêt' }).check();
    await headerButton(page, 'Phase').click();
    await expect(canvas(page).locator('cd-phase')).toHaveCount(CREWDECK.phases + 1);
    expect(puts).toHaveLength(1);
    release();

    await expect.poll(() => puts.length).toBe(2);
    expect(puts[1]?.revision).toBe(1);
    expect(puts[1]?.definition.phases).toHaveLength(CREWDECK.phases + 1);
    expect(puts[1]?.definition.phases.find((candidate) => candidate.id === 'ph-dev')?.forEach).toBe('ticket.ready');
    await expect.poll(async () => (await stored(page, projectOf(run.path))).draft?.revision).toBe(2);
    expect(puts).toHaveLength(2);
  });

  test('a 409 from another tab’s save: « Le brouillon a changé dans un autre onglet… », and that tab’s draft shown', async ({ page, scenario, baseURL }) => {
    const run = await scenario('process-phase');
    await expect(card(page, 'st-review')).toContainText('Review');
    const projectId = projectOf(run.path);
    const origin = new URL(baseURL ?? 'http://localhost:4200').origin;
    const { active } = await stored(page, projectId);
    if (!active) throw new Error('no active version');
    const other = structuredClone(active.definition);
    const review = other.steps.find((step) => step.id === 'st-review');
    if (!review) throw new Error('no Review');
    review.name = 'Relecture';

    let first = true;
    await page.route('**/api/projects/*/process/draft', async (route: Route) => {
      if (first) {
        first = false;
        // Another tab saves first, on the same revision.
        const saved = await page.request.put(`/api/projects/${projectId}/process/draft`, {
          data: { definition: other, sealed: null, revision: 0, baseVersion: active.number },
          headers: { origin },
        });
        expect(saved.status(), await saved.text()).toBe(200);
      }
      await route.continue();
    });

    await panel(page).getByRole('radio', { name: 'Une fois' }).check();
    await expect(toast(page)).toContainText('Le brouillon a changé dans un autre onglet : ton dernier changement n’est pas enregistré.');
    await expect(card(page, 'st-review')).toContainText('Relecture');
    await expect(panel(page).getByRole('radio', { name: 'Pour chaque Ticket prêt' })).toBeChecked();
    expect((await stored(page, projectId)).draft?.definition.phases.find((phase) => phase.id === 'ph-dev')?.forEach).toBe('ticket.ready');
  });

  test('a Phase chosen, the editor ready to edit it: accessible', async ({ page, scenario, expectAccessible }) => {
    await scenario('process-phase');
    await expect(panel(page).getByRole('textbox', { name: 'Nom de la Phase' })).toHaveValue('Développement');
    await expect(headerButton(page, 'Phase')).toBeVisible();
    await expectAccessible(page);
  });
});
