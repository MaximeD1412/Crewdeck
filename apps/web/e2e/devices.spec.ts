import type { Browser, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { linkFirstAppareil, secretBytes } from './runner-link.js';

/**
 * E2E-3 (US-60, ADR 0003 « A new Appareil »): a browser signed in to the
 * account approved from a trusted one by its code, pasted; the code never
 * typed short, its secret never sent. The QR code is the same text, which a
 * camera reads where the browser can (`BarcodeDetector`, not in this Chromium).
 */

/** The code `crewdeck:appareil:` carries: 4 + 26 Crockford characters. */
const CODE = /^([0-9A-Z]{4})-([0-9A-Z]{26})$/;
/** A secret of the code's form, for a short id the server knows. */
const SOME_SECRET = 'ABCDEFGHJKMNPQRSTVWXYZ0120';

const appareilsCard = (page: Page) => page.locator('cd-page-parametres > cd-card[slot=devices]');
const deviceBanner = (page: Page) => page.locator('#app > cd-cadre > cd-banner[slot=banner]');
const newDevice = (page: Page) => page.locator('crewdeck-new-device').getByRole('dialog');
const approveDevice = (page: Page) => page.locator('crewdeck-approve-device').getByRole('dialog');

/** Every request a page sends, its body with it: the secret must be in none. */
const recorded = (page: Page): string[] => {
  const sent: string[] = [];
  page.on('request', (request) => sent.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`));
  return sent;
};

/** Another browser, as the project's (width, locale, time zone), signed in with the same session cookie. */
const otherBrowser = async (browser: Browser, testInfo: TestInfo, sessionCookie: string) => {
  const { viewport, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId, baseURL } = testInfo.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId, baseURL });
  const separator = sessionCookie.indexOf('=');
  await context.addCookies([
    { name: sessionCookie.slice(0, separator), value: sessionCookie.slice(separator + 1), url: baseURL ?? 'http://localhost:4200', httpOnly: true, sameSite: 'Lax' },
  ]);
  return context;
};

/** The Paramètres' « Appareils » section, which the phone shows from its link. */
const openAppareils = async (page: Page) => {
  await page.goto('/parametres');
  await page.getByRole('navigation', { name: 'Paramètres / Sections' }).getByRole('link', { name: 'Appareils' }).click();
  await expect(appareilsCard(page)).toBeVisible();
};

/**
 * The vault of `page` opened: only an opened vault holds the key a wrap
 * seals, so « Ajouter un Appareil » asks for a code there, and says
 * « … n’a pas encore ouvert tes données chiffrées » elsewhere.
 */
const expectVaultOpen = async (page: Page) => {
  await appareilsCard(page).getByRole('button', { name: 'Ajouter un Appareil' }).click();
  const dialog = approveDevice(page);
  await expect(dialog.getByLabel('Colle le code affiché sur le nouvel Appareil')).toBeVisible();
  await expect(dialog).not.toContainText('n’a pas encore ouvert tes données chiffrées');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(approveDevice(page)).toHaveCount(0);
};

/** « Ajouter un Appareil », the code pasted, « Continuer ». */
const pasteCode = async (page: Page, code: string) => {
  await appareilsCard(page).getByRole('button', { name: 'Ajouter un Appareil' }).click();
  const dialog = approveDevice(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Colle le code affiché sur le nouvel Appareil').fill(code);
  await dialog.getByRole('button', { name: 'Continuer' }).click();
  return dialog;
};

test('a new browser shows its code, which the trusted Appareil approves by pasting it: the new one opens the vault; the code used is refused after', async ({
  page,
  browser,
  baseURL,
  scenario,
  expectAccessible,
}, testInfo) => {
  const sentTrusted = recorded(page);
  const run = await scenario('appareils');
  await linkFirstAppareil(page, baseURL);

  // The trusted Appareil alone: « cet Appareil », and the OPS-1 Banner.
  await openAppareils(page);
  const card = appareilsCard(page);
  await expect(card.locator('cd-list-row')).toHaveCount(1);
  await expect(card.locator('cd-list-row')).toContainText('cet Appareil');
  await expect(card).toContainText('Un seul Appareil lit tes données chiffrées : ajoute ton téléphone pour ne rien perdre.');
  await expect(deviceBanner(page)).toHaveCount(0);
  await expectAccessible(page);

  // The new browser: the Banner, then its QR code and its code.
  const context = await otherBrowser(browser, testInfo, run.sessionCookie ?? '');
  const fresh = await context.newPage();
  const sentNew = recorded(fresh);
  await fresh.goto('/parametres');
  await expect(deviceBanner(fresh)).toContainText('Cet Appareil ne lit pas encore tes Sessions ni le texte de tes Idées.');
  await expectAccessible(fresh);
  await deviceBanner(fresh).getByRole('button', { name: 'Approuver cet Appareil' }).click();
  const shown = newDevice(fresh);
  await expect(shown.getByRole('heading', { name: 'Approuver cet Appareil' })).toBeVisible();
  await expect(shown.getByRole('img', { name: 'QR code de cet Appareil' })).toBeVisible();
  await expect(shown.locator('code').first()).toHaveText(CODE);
  const code = (await shown.locator('code').first().textContent()) ?? '';
  await expect(shown.locator('code').nth(1)).toHaveText(`crewdeck-runner appareils approuver ${code}`);
  await expect(shown).toContainText(/Expire dans (10:00|9:\d\d)\./);
  await expect(shown.getByRole('status')).toHaveText('En attente de l’approbation…');
  await expectAccessible(fresh);

  // The trusted Appareil pastes it, reads the new one's name, approves.
  const asked = await pasteCode(page, code);
  await expect(asked.getByRole('heading', { name: /^Approuver « .+ sur .+ » \?$/ })).toBeVisible();
  const name = /^Approuver « (.+) » \?$/.exec((await asked.getByRole('heading').textContent()) ?? '')?.[1] ?? '';
  await expectAccessible(page);
  await asked.getByRole('button', { name: 'Approuver' }).click();
  await expect(asked.getByRole('status')).toHaveText(`« ${name} » est approuvé : il lit maintenant tes Sessions et le texte de tes Idées.`);
  await asked.getByRole('button', { name: 'Fermer' }).click();
  await expect(approveDevice(page)).toHaveCount(0);
  await expect(card.locator('cd-list-row')).toHaveCount(2);
  await expect(card).not.toContainText('Un seul Appareil');

  // The new one checked who approved it, opened its wrap of the vault key: approved, its Banner gone.
  await expect(shown.getByRole('heading', { name: 'Appareil approuvé' })).toBeVisible();
  await expect(shown.getByRole('status')).toHaveText('Cet Appareil lit maintenant tes Sessions et le texte de tes Idées.');
  expect(sentNew.some((line) => /GET \S+\/api\/devices\/[^/]+\/approval /.test(line))).toBe(true);
  expect(sentNew.some((line) => /GET \S+\/api\/devices\/[^/]+\/vault-key-wrap /.test(line))).toBe(true);
  await expect(deviceBanner(fresh)).toHaveCount(0);
  await shown.getByRole('button', { name: 'Fermer' }).click();
  // Its vault really open: the wrap the trusted one sealed opened with its own key.
  await fresh.getByRole('navigation', { name: 'Paramètres / Sections' }).getByRole('link', { name: 'Appareils' }).click();
  await expectVaultOpen(fresh);
  // After a reload too: the vault opens from what this browser keeps.
  await openAppareils(fresh);
  await expect(deviceBanner(fresh)).toHaveCount(0);
  const rows = appareilsCard(fresh).locator('cd-list-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'cet Appareil' })).toContainText(name);
  await expectVaultOpen(fresh);

  // The code used, then a code that expired: refused, the dialog says so.
  for (const refused of [code, `7K2Q-${SOME_SECRET}`]) {
    const again = await pasteCode(page, refused);
    await expect(again.getByRole('alert')).toHaveText('Ce code est inconnu ou a expiré : affiche un nouveau code sur le nouvel Appareil.');
    await expect(again.getByLabel('Colle le code affiché sur le nouvel Appareil')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    await again.getByRole('button', { name: 'Annuler' }).click();
  }

  // The secret, as text or as bytes, is in no request of either browser.
  const [, , secret = ''] = CODE.exec(code) ?? [];
  const leaked = [...sentTrusted, ...sentNew].filter((line) => line.includes(secret) || line.includes(secretBytes(secret).toString('base64url')));
  expect(leaked).toEqual([]);
  await context.close();
});

test('a new Appareil’s code expires after 10 minutes: « Code expiré », and « Recommencer » shows a new one', async ({ page, scenario, expectAccessible }) => {
  await page.clock.install();
  await scenario('appareil-a-approuver');
  await deviceBanner(page).getByRole('button', { name: 'Approuver cet Appareil' }).click();
  const shown = newDevice(page);
  await expect(shown.locator('code').first()).toHaveText(CODE);
  const first = await shown.locator('code').first().textContent();

  await page.clock.fastForward('10:01');
  await expect(shown.getByRole('heading', { name: 'Code expiré' })).toBeVisible();
  await expect(shown.getByRole('status')).toHaveText('Ce code a expiré avant d’être approuvé. Recommence pour en afficher un nouveau.');
  await expect(shown.locator('code')).toHaveCount(0);
  await expectAccessible(page);

  // The page's clock back to the server's: the new code's 10 minutes start from it.
  await page.clock.setSystemTime(new Date());
  await shown.getByRole('button', { name: 'Recommencer' }).click();
  await expect(shown.getByRole('heading', { name: 'Approuver cet Appareil' })).toBeVisible();
  await expect(shown.locator('code').first()).toHaveText(CODE);
  expect(await shown.locator('code').first().textContent()).not.toBe(first);
});
