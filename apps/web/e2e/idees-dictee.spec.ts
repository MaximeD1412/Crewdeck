import type { Page, Request } from '@playwright/test';
import { installFakeSpeech, removeSpeech, type FakeSpeechControl } from '../src/dictation/fake-speech.js';
import { expect, test } from './fixtures.js';

/**
 * IDEE-4: the dictation of an Idée, and of a message to an agent, through
 * the browser's Web Speech API (ADR 0007). The browser's recognition is the
 * fake of `src/dictation/fake-speech.ts`, installed before the page's code:
 * no microphone, no speech service.
 */

const ROWS = 'cd-page-idees cd-idea-row';
const dialogBox = (page: Page) => page.getByRole('dialog', { name: 'Noter une Idée' });
const dialog = (page: Page) => page.locator('cd-note-idea-dialog');
const text = (page: Page) => dialog(page).getByRole('textbox', { name: 'Ton Idée, en une phrase' });
const dictate = (page: Page) => dialog(page).getByRole('button', { name: 'Dicter', exact: true });
const stop = (page: Page) => dialog(page).getByRole('button', { name: 'Arrêter la dictée', exact: true });
const recording = (page: Page) => dialog(page).locator('.rec');
const NOTICE = 'La dictée passe par le service de reconnaissance de ton navigateur (Google pour Chrome, Apple pour Safari).';

/** The fake's control in the page: Playwright sends the callback alone, so it reads `window` itself. */
type WithFake = Window & { fakeSpeech: FakeSpeechControl };
const say = (page: Page, words: string, final: boolean) => page.evaluate(([w, f]) => (window as unknown as WithFake).fakeSpeech.say(w, f), [words, final] as const);
const fail = (page: Page, error: string) => page.evaluate((e) => (window as unknown as WithFake).fakeSpeech.fail(e), error);
const speech = (page: Page) =>
  page.evaluate(() => {
    const { started, listening, settings } = (window as unknown as WithFake).fakeSpeech;
    return { started, listening, settings };
  });

const openDialog = async (page: Page) => {
  await expect(page.locator(ROWS)).toHaveCount(4);
  await page.locator('cd-page-idees cd-page-header').getByRole('button', { name: 'Noter une Idée' }).click();
  await expect(dialogBox(page)).toBeVisible();
};

const noted = (page: Page): Promise<Request> =>
  page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/ideas');
const dictatedOf = (request: Request): unknown => (JSON.parse(request.postData() ?? '{}') as { dictated?: unknown }).dictated;
/** What the server stored of the Idée noted last: `GET /api/ideas`, the last updated first. */
const storedDictated = async (page: Page): Promise<unknown> => {
  const response = await page.request.get('/api/ideas?states=to-triage');
  expect(response.status()).toBe(200);
  return ((await response.json()) as { items: { dictated: unknown }[] }).items[0]?.dictated;
};

test.describe('the dictation of an Idée (IDEE-4)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installFakeSpeech);
  });

  test('« Dicter » fills the field as it hears, « Dictée en cours · 0:0n », then stops; the text corrected is noted dictated, accessible', async ({
    page,
    scenario,
    expectAccessible,
  }) => {
    await scenario('idees-dictee');
    await openDialog(page);
    await expect(recording(page)).toHaveCount(0);

    await dictate(page).click();
    await expect(stop(page)).toBeVisible();
    expect(await speech(page)).toEqual({ started: 1, listening: true, settings: { lang: 'fr-FR', continuous: true, interimResults: true } });
    await expect(recording(page)).toContainText(/Dictée en cours · 0:0\d/);
    await expect(recording(page).locator('cd-status-dot')).toHaveCount(1);
    // The first dictation of this Appareil says who hears it.
    await expect(dialog(page)).toContainText(NOTICE);
    await expect(dialog(page)).toContainText('Transcription en direct : tu pourras la corriger avant de noter.');

    await say(page, 'Pouvoir dupliquer', false);
    await expect(text(page)).toHaveValue('Pouvoir dupliquer');
    await say(page, 'Pouvoir dupliquer une recette', true);
    await say(page, 'pour en faire une variante', false);
    await expect(text(page)).toHaveValue('Pouvoir dupliquer une recette pour en faire une variante');
    await expectAccessible(page);

    await stop(page).click();
    await expect(dictate(page)).toBeVisible();
    await expect(recording(page)).toHaveCount(0);
    expect((await speech(page)).listening).toBe(false);
    // Stopped, the field stays the Pilote's: they correct it before noting it.
    await expect(text(page)).toBeEditable();
    await text(page).fill('Pouvoir dupliquer une recette pour en faire une variante végétarienne');

    const sent = noted(page);
    await dialog(page).getByRole('button', { name: 'Noter', exact: true }).click();
    const request = await sent;
    expect(dictatedOf(request)).toBe(true);
    expect(request.postData()).not.toContain('dupliquer');
    await expect(dialogBox(page)).toBeHidden();
    await expect(page.locator(ROWS).first()).toContainText('Pouvoir dupliquer une recette pour en faire une variante végétarienne');
    expect(await storedDictated(page)).toBe(true);
  });

  test('« Noter » while dictating stops the dictation; an Idée only typed is not dictated', async ({ page, scenario }) => {
    await scenario('idees-dictee');
    await openDialog(page);
    await text(page).fill('Une Idée :');
    await dictate(page).click();
    await say(page, 'chercher par ingrédient', true);
    await expect(text(page)).toHaveValue('Une Idée : chercher par ingrédient');
    const sent = noted(page);
    await dialog(page).getByRole('button', { name: 'Noter', exact: true }).click();
    expect(dictatedOf(await sent)).toBe(true);
    await expect(dialogBox(page)).toBeHidden();
    expect((await speech(page)).listening).toBe(false);

    await page.locator('cd-page-idees cd-page-header').getByRole('button', { name: 'Noter une Idée' }).click();
    await expect(text(page)).toHaveValue('');
    await text(page).fill('Une Idée tapée');
    const typed = noted(page);
    await dialog(page).getByRole('button', { name: 'Noter', exact: true }).click();
    expect(dictatedOf(await typed)).toBe(false);
    await expect(dialogBox(page)).toBeHidden();
    await expect(page.locator(ROWS).first()).toContainText('Une Idée tapée');
    expect(await storedDictated(page)).toBe(false);
  });

  test('the notice shows at the first dictation of the Appareil only', async ({ page, scenario }) => {
    await scenario('idees-dictee');
    await openDialog(page);
    await dictate(page).click();
    await expect(dialog(page)).toContainText(NOTICE);
    await stop(page).click();
    await expect(dialog(page)).not.toContainText(NOTICE);

    await dictate(page).click();
    await expect(stop(page)).toBeVisible();
    await expect(dialog(page)).not.toContainText(NOTICE);
    await stop(page).click();

    await page.reload();
    await openDialog(page);
    await dictate(page).click();
    await expect(stop(page)).toBeVisible();
    await expect(dialog(page)).not.toContainText(NOTICE);
  });

  test('the microphone refused: « Micro refusé », back to « Dicter », accessible', async ({ page, scenario, expectAccessible }) => {
    await scenario('idees-dictee');
    await openDialog(page);
    await dictate(page).click();
    await fail(page, 'not-allowed');
    await expect(dialog(page).getByRole('alert')).toHaveText('Micro refusé : autorise-le dans ton navigateur.');
    await expect(dictate(page)).toBeVisible();
    await expect(recording(page)).toHaveCount(0);
    await expect(text(page)).toBeEditable();
    await expectAccessible(page);
  });

  test('stops by itself after a minute, the transcript kept', async ({ page, scenario }) => {
    await page.clock.install();
    await scenario('idees-dictee');
    await openDialog(page);
    await dictate(page).click();
    await say(page, 'Une Idée dictée', true);
    await page.clock.runFor(30_000);
    await expect(recording(page)).toContainText(/Dictée en cours · 0:3\d/);
    await page.clock.runFor(30_000);
    await expect(dictate(page)).toBeVisible();
    expect((await speech(page)).listening).toBe(false);
    await expect(text(page)).toHaveValue('Une Idée dictée');
    await expect(dialog(page).getByRole('alert')).toHaveCount(0);
  });
});

test.describe('the dictation of a message to an agent (IDEE-4)', () => {
  const panel = (page: Page) => page.locator('#app > cd-cadre > cd-session[slot=panel]');
  const field = (page: Page) => panel(page).getByRole('textbox', { name: 'Écrire à l’agent, ou dicter' });

  test('the Composer’s mic fills its field without sending it; the Pilote sends it', async ({ page, scenario, expectAccessible }) => {
    await page.addInitScript(installFakeSpeech);
    await scenario('session');
    await expect(field(page)).toBeVisible();
    await field(page).fill('Pense');
    await panel(page).getByRole('button', { name: 'Dicter' }).click();
    await expect(panel(page)).toContainText(/Dictée en cours · 0:0\d/);
    await say(page, 'aux événements récurrents.', true);
    await expect(field(page)).toHaveValue('Pense aux événements récurrents.');
    await expectAccessible(page);
    await panel(page).getByRole('button', { name: 'Arrêter la dictée' }).click();
    await expect(panel(page).getByRole('button', { name: 'Dicter' })).toBeVisible();
    await expect(panel(page)).not.toContainText('Noté : « Pense aux événements récurrents. ».');

    await field(page).press('Enter');
    await expect(panel(page)).toContainText('Noté : « Pense aux événements récurrents. ».');
    await expect(field(page)).toHaveValue('');
  });
});

test.describe('a browser without the Web Speech API (IDEE-4)', () => {
  test('has no « Dicter », in the Dialog nor in the Composer', async ({ page, scenario }) => {
    await page.addInitScript(removeSpeech);
    await scenario('idees-dictee');
    await openDialog(page);
    await expect(text(page)).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: /Dicter|Arrêter la dictée/ })).toHaveCount(0);
    await text(page).fill('Une Idée tapée');
    const typed = noted(page);
    await dialog(page).getByRole('button', { name: 'Noter', exact: true }).click();
    expect(dictatedOf(await typed)).toBe(false);

    await scenario('session');
    const panel = page.locator('#app > cd-cadre > cd-session[slot=panel]');
    await expect(panel.getByRole('textbox', { name: 'Écrire à l’agent, ou dicter' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Envoyer' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Dicter' })).toHaveCount(0);
  });
});
