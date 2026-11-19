import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Paramètres / Sections' });
const zone = (page: Page) => page.getByRole('combobox', { name: 'Zone IANA' });
const library = (page: Page) => page.getByRole('link', { name: /Bibliothèque de Composants/ });
const roleRows = (page: Page) => page.locator('cd-role-settings cd-setting-row');
const roleSelect = (page: Page, name: string) => page.getByRole('combobox', { name: `Moteur et modèle du Rôle ${name}` });
const chosen = (page: Page, name: string) => roleSelect(page, name).locator('option:checked');
const pushToggle = (page: Page) => page.locator('cd-push-settings').getByRole('switch', { name: 'Notifications push' });
const browsers = (page: Page) => page.locator('cd-push-settings cd-list-row');
const desktop = (viewport: { width: number } | null) => (viewport?.width ?? 0) >= 1280;

/** On the phone the Paramètres show one section at a time: opens `section`'s; at 1280 px they all show. */
const show = async (page: Page, section: string, viewport: { width: number } | null) => {
  if (!desktop(viewport)) await nav(page).getByRole('link', { name: section }).click();
};

/**
 * US-82, US-18: the Paramètres of the account show only the sections that
 * have content, « Rôles et modèles », « Notifications », « Par Projet », « Compte »
 * with the time zone and « Pour les Moddeurs »; on the phone one at a time, the one its link opens,
 * at 1280 px all. A time zone picked is saved, and another tab of the Pilote
 * shows it at once.
 */
test('the Paramètres: the sections with content only, the time zone saved and shown live in another tab, the library a link away', async ({
  page,
  scenario,
  expectAccessible,
  viewport,
}) => {
  await scenario('parametres');
  await expect(page.getByRole('heading', { level: 1, name: 'Paramètres' })).toBeVisible();
  await expect(nav(page).getByRole('link')).toHaveText(['Rôles et modèles', 'Notifications', 'Par Projet', 'Compte', 'Pour les Moddeurs']);
  await show(page, 'Compte', viewport);
  await expect(zone(page)).toHaveValue('Europe/Paris');
  await expectAccessible(page);

  if (desktop(viewport)) {
    await expect(library(page)).toBeVisible();
  } else {
    await expect(library(page)).toBeHidden();
    await nav(page).getByRole('link', { name: 'Pour les Moddeurs' }).click();
    await expect(library(page)).toBeVisible();
    await expect(zone(page)).toBeHidden();
    await expect(page).toHaveURL('/parametres');
    await nav(page).getByRole('link', { name: 'Compte' }).click();
  }

  const other = await page.context().newPage();
  await other.goto('/parametres');
  await show(other, 'Compte', viewport);
  await expect(zone(other)).toHaveValue('Europe/Paris');

  await zone(page).selectOption('Asia/Tokyo');
  await expect(zone(other)).toHaveValue('Asia/Tokyo');
  const me = await page.request.get('/api/me');
  expect(await me.json()).toMatchObject({ timeZone: 'Asia/Tokyo' });
  await other.reload();
  await show(other, 'Compte', viewport);
  await expect(zone(other)).toHaveValue('Asia/Tokyo');
  await other.close();

  await show(page, 'Pour les Moddeurs', viewport);
  await library(page).click();
  await expect(page).toHaveURL('/parametres/composants');
  await expect(page.locator('cd-page-composants')).toBeVisible();
});

/**
 * PARAM-2, US-39, US-38: « Rôles et modèles », a model per Rôle among the
 * usable ones only, the Review on another Moteur than the Code by default;
 * a choice, a Rôle added or removed shows at once in another tab; a name
 * taken is refused under its field.
 */
test('« Rôles et modèles »: the usable models only, a choice and a Rôle added or removed shown live in another tab, a name taken refused', async ({ page, scenario, expectAccessible }) => {
  await scenario('parametres');
  await expect(nav(page).getByRole('link', { name: 'Rôles et modèles' })).toHaveAttribute('aria-current', 'true');
  await expect(roleRows(page)).toHaveCount(5);
  await expect(roleRows(page).nth(0)).toContainText('Analyse chaque Idée notée.');
  await expect(roleRows(page).nth(3)).toContainText('Relit chaque changement de code. Par défaut sur un autre Moteur que le Code.');
  await expect(roleRows(page).nth(4)).toContainText('Un Rôle à toi : nomme-le dans une Étape de la Gestion du process.');
  await expect(chosen(page, 'Idée')).toHaveText('Claude Code · Sonnet 5.5');
  await expect(chosen(page, 'Conception')).toHaveText('Claude Code · Opus 5.5');
  await expect(chosen(page, 'Code')).toHaveText('Claude Code · Opus 5.5');
  await expect(chosen(page, 'Review')).toHaveText('Codex · GPT-5.5');
  await expect(chosen(page, 'Revue Codex')).toHaveText('Codex · GPT-5.5');
  // Fable outside the plan, GPT-5.5 Pro at its quota: never offered.
  await expect(roleSelect(page, 'Review').locator('option')).toHaveText(['Claude Code · Opus 5.5', 'Claude Code · Sonnet 5.5', 'Codex · GPT-5.5']);
  await expectAccessible(page);

  const other = await page.context().newPage();
  await other.goto('/parametres');
  await expect(chosen(other, 'Code')).toHaveText('Claude Code · Opus 5.5');

  await roleSelect(page, 'Code').selectOption({ label: 'Codex · GPT-5.5' });
  await expect(chosen(other, 'Code')).toHaveText('Codex · GPT-5.5');

  await page.getByRole('button', { name: 'Ajouter un Rôle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau Rôle' });
  // Its fields are slotted into the Dialog: found from its host, locators do not follow slots.
  const form = page.locator('cd-role-settings cd-dialog');
  await expect(dialog).toBeVisible();
  await form.getByRole('textbox', { name: 'Nom' }).fill('revue codex');
  await form.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(form.getByRole('textbox', { name: 'Nom' })).toHaveAccessibleDescription(/Un Rôle porte déjà ce nom\./);
  await expectAccessible(page);

  await form.getByRole('textbox', { name: 'Nom' }).fill('Revue Claude');
  await form.getByRole('combobox', { name: 'Moteur et modèle' }).selectOption({ label: 'Claude Code · Sonnet 5.5' });
  await form.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(chosen(page, 'Revue Claude')).toHaveText('Claude Code · Sonnet 5.5');
  await expect(chosen(other, 'Revue Claude')).toHaveText('Claude Code · Sonnet 5.5');

  await roleRows(page).filter({ hasText: 'Revue Codex' }).getByRole('button', { name: 'Retirer' }).click();
  await expect(roleRows(page)).toHaveCount(5);
  await expect(roleRows(other).filter({ hasText: 'Revue Codex' })).toHaveCount(0);
  await expect(roleRows(other).filter({ hasText: 'Revue Claude' })).toHaveCount(1);
  await expect(roleRows(page).getByRole('button', { name: 'Retirer' })).toHaveCount(1);

  await other.reload();
  await expect(roleRows(other)).toHaveCount(5);
  await expect(chosen(other, 'Code')).toHaveText('Codex · GPT-5.5');
  await other.close();
});

/**
 * ATOI-4, US-18: « Notifications », the account's push and the browsers that
 * receive it; switched off or a browser removed, another tab shows it at
 * once. The page is installable: its manifest, its icons and its service
 * worker, registered at the scope of the whole page. Subscribing needs a push
 * service the test browser lacks: `push-settings.spec.ts` proves it.
 */
test('« Notifications »: the push switched and a browser removed, shown live in another tab; the manifest and the service worker', async ({
  page,
  scenario,
  expectAccessible,
  viewport,
}) => {
  await scenario('parametres');
  await show(page, 'Notifications', viewport);
  await expect(pushToggle(page)).toBeChecked();
  await expect(browsers(page)).toHaveCount(1);
  await expect(browsers(page)).toContainText(['Safari · iPhone']);
  await expect(browsers(page)).toContainText(['autorisé le 3 nov.']);
  await expect(page.locator('cd-push-settings').getByRole('button', { name: 'Activer sur cet appareil' })).toBeVisible();
  await expectAccessible(page);

  const other = await page.context().newPage();
  await other.goto('/parametres');
  await show(other, 'Notifications', viewport);
  await expect(pushToggle(other)).toBeChecked();

  await pushToggle(page).click();
  await expect(pushToggle(other)).not.toBeChecked();
  const settings = await page.request.get('/api/settings');
  expect(await settings.json()).toMatchObject({ notifications: { push: false } });

  await browsers(page).getByRole('button', { name: 'Retirer' }).click();
  await expect(browsers(page)).toHaveCount(0);
  await expect(browsers(other)).toHaveCount(0);
  await other.close();

  const manifest = await page.request.get('/manifest.webmanifest');
  expect(await manifest.json()).toMatchObject({ name: 'Crewdeck', start_url: '/a-toi', display: 'standalone', theme_color: '#0d1317' });
  expect((await page.request.get('/icons/icon-512.png')).headers()['content-type']).toBe('image/png');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL('/', page.url()).href);
});

/** ATOI-4: where this browser cannot push (no `PushManager`, an iPhone outside the home-screen app), the help instead of the button. */
test('« Notifications » without PushManager: the help of the home screen instead of « Activer sur cet appareil »', async ({ page, scenario, expectAccessible, viewport }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'PushManager');
  });
  await scenario('parametres-notifications-iphone');
  await show(page, 'Notifications', viewport);
  await expect(page.locator('cd-push-settings')).toContainText(
    'Sur iPhone, ajoute Crewdeck à l’écran d’accueil (Partager → Sur l’écran d’accueil) pour recevoir les notifications.',
  );
  await expect(page.locator('cd-push-settings').getByRole('button', { name: 'Activer sur cet appareil' })).toHaveCount(0);
  await expect(browsers(page)).toContainText(['Safari · iPhone']);
  await expectAccessible(page);
});

/**
 * CORE-11, US-1: « Connexion » lists the Identités of a Pilote signed in by
 * email; « Relier GitHub » goes through GitHub, comes back to the
 * Paramètres and lists GitHub, the page still signed in.
 */
test('« Connexion »: the Identités, « Relier GitHub » through GitHub and back on the Paramètres, GitHub listed', async ({ page, scenario, expectAccessible, viewport }) => {
  await scenario('parametres');
  await show(page, 'Compte', viewport);
  const connexion = page.locator('cd-account-identities');
  await expect(connexion.getByText('pilote@example.com')).toBeVisible();
  await expect(connexion.getByText('pas relié · pour suivre tes Dépôts GitHub')).toBeVisible();
  await expectAccessible(page);

  await connexion.getByRole('button', { name: 'Relier GitHub' }).click();

  await expect(page).toHaveURL('/parametres');
  await show(page, 'Compte', viewport);
  await expect(connexion.getByText('octocat')).toBeVisible();
  await expect(connexion.getByRole('button', { name: 'Relier GitHub' })).toHaveCount(0);
  const me = (await (await page.request.get('/api/me')).json()) as { githubLinked: boolean; identities: { provider: string }[] };
  expect(me.githubLinked).toBe(true);
  expect(me.identities.map((identity) => identity.provider).sort()).toEqual(['email', 'github']);
});
