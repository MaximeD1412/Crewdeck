import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { becomeTrustedDevice } from './trusted-device.js';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Paramètres du Projet / Sections' });
const roleSelect = (page: Page, name: string) => page.getByRole('combobox', { name: `Moteur et modèle du Rôle ${name}` });
const chosen = (page: Page, name: string) => roleSelect(page, name).locator('option:checked');
const row = (page: Page, label: string) => page.locator('cd-setting-row').filter({ has: page.getByText(label, { exact: true }) });
const textbox = (page: Page, name: string) => page.getByRole('textbox', { name });
const push = (page: Page) => page.getByRole('switch', { name: 'Notifications push' });
const desktop = (viewport: { width: number } | null) => (viewport?.width ?? 0) >= 1280;

/** On the phone the Paramètres show one section at a time: opens `section`'s; at 1280 px they all show. */
const show = async (page: Page, section: string, viewport: { width: number } | null) => {
  if (!desktop(viewport)) await nav(page).getByRole('link', { name: section }).click();
};

/** A text field's value typed in and sent, as the page sends it: once it loses the focus. */
const type = async (page: Page, name: string, value: string) => {
  await textbox(page, name).fill(value);
  await textbox(page, name).blur();
};

/**
 * PARAM-3, US-82, US-39: « Par Projet » on the account's Paramètres lists
 * each Projet with what it changed; its Paramètres show each Rôle with where
 * it comes from, the account's or the Projet's. A Rôle changed for the
 * Projet says so and counts; « Revenir au compte » makes it follow the
 * account again, live.
 */
test('a Projet’s Paramètres: opened from « Par Projet », each Rôle inherited or changed, « Revenir au compte » following the account again', async ({
  page,
  scenario,
  expectAccessible,
  viewport,
}) => {
  await scenario('parametres');
  if (!desktop(viewport)) await page.getByRole('navigation', { name: 'Paramètres / Sections' }).getByRole('link', { name: 'Par Projet' }).click();
  const projects = page.locator('cd-card[slot=projects] cd-list-row');
  await expect(projects).toHaveText([/Crewdeck\s*hérite de ton compte/, /Personal OS\s*hérite de ton compte/, /Site mairie\s*2 Paramètres modifiés/]);
  await projects.filter({ hasText: 'Site mairie' }).getByRole('link').click();

  await expect(page).toHaveURL(/\/projets\/[0-9a-f-]+\/parametres$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Site mairie' })).toBeVisible();
  await expect(page.getByText('Paramètres du Projet · 2 modifiés')).toBeVisible();
  await expect(page.getByText('Ce Projet hérite de ton compte')).toBeVisible();
  await expect(nav(page).getByRole('link')).toHaveText([/^Rôles et modèles\s*2/, 'Étapes', 'Branches', 'Worktree', 'Notifications']);
  await expect(chosen(page, 'Idée')).toHaveText('Claude Code · Sonnet 5.5');
  await expect(row(page, 'Idée')).toContainText('Hérité du compte');
  await expect(chosen(page, 'Code')).toHaveText('Codex · GPT-5.5');
  await expect(row(page, 'Code')).toContainText('Modifié pour ce Projet');
  await expect(chosen(page, 'Review')).toHaveText('Claude Code · Opus 5.5');
  await expect(row(page, 'Review')).toContainText('Modifié pour ce Projet');
  await expectAccessible(page);

  // A Rôle changed for the Projet only: the account keeps its own.
  await roleSelect(page, 'Conception').selectOption({ label: 'Codex · GPT-5.5' });
  await expect(row(page, 'Conception')).toContainText('Modifié pour ce Projet');
  await expect(page.getByText('Paramètres du Projet · 3 modifiés')).toBeVisible();
  const account = await (await page.request.get('/api/settings')).json();
  // The account's Conception stays its default.
  expect(account.roles.design).toBeNull();

  // Back to the account: the Projet follows it, a change of the account shown at once.
  await page.getByRole('button', { name: 'Revenir au compte pour Conception' }).click();
  await expect(row(page, 'Conception')).toContainText('Hérité du compte');
  await expect(chosen(page, 'Conception')).toHaveText('Claude Code · Opus 5.5');
  await expect(page.getByText('Paramètres du Projet · 2 modifiés')).toBeVisible();
  const other = await page.context().newPage();
  await other.goto('/parametres');
  await roleSelect(other, 'Conception').selectOption({ label: 'Claude Code · Sonnet 5.5' });
  await expect(chosen(page, 'Conception')).toHaveText('Claude Code · Sonnet 5.5');
  await expect(chosen(page, 'Code')).toHaveText('Codex · GPT-5.5');
  await other.close();
});

/** PARAM-3: the Projet's two branches, saved once typed and kept after a reload; one name for both refused under the field. */
test('a Projet’s branches: saved, kept after a reload, one name for both refused', async ({ page, scenario, viewport }) => {
  await scenario('parametres-projet');
  await show(page, 'Branches', viewport);
  await expect(textbox(page, 'Branche d’intégration')).toHaveValue('develop');
  await expect(textbox(page, 'Branche de release')).toHaveValue('main');

  await type(page, 'Branche de release', 'develop');
  await expect(page.getByText('La branche d’intégration et la branche de release sont deux branches.')).toBeVisible();
  await expect(textbox(page, 'Branche de release')).toHaveValue('develop');

  await type(page, 'Branche de release', 'production');
  await expect(page.getByText('La branche d’intégration et la branche de release sont deux branches.')).toBeHidden();
  await page.reload();
  await show(page, 'Branches', viewport);
  await expect(textbox(page, 'Branche de release')).toHaveValue('production');
});

/**
 * PARAM-3, ADR 0003, ADR 0013: the worktree Commandes are sealed. A browser
 * that is no trusted Appareil cannot read nor change them; the trusted
 * Appareil opens them, and what it writes is kept after a reload, the server
 * only ever holding ciphertext.
 */
test('the worktree Commandes: closed without a trusted Appareil, opened and changed on one, sealed on the server', async ({ page, scenario, expectAccessible, viewport }) => {
  const run = await scenario('parametres-projet');
  await show(page, 'Worktree', viewport);
  await expect(textbox(page, 'Préparer le worktree')).toBeDisabled();
  await expect(textbox(page, 'Nettoyer le worktree')).toBeDisabled();
  await expect(textbox(page, 'Préparer le worktree')).toHaveValue('');
  await expect(row(page, 'Préparer le worktree')).toContainText('Ouvre ces Paramètres sur un Appareil de confiance pour lire et changer les Commandes.');

  await becomeTrustedDevice(page);
  await show(page, 'Worktree', viewport);
  await expect(textbox(page, 'Préparer le worktree')).toHaveValue('pnpm install --frozen-lockfile');
  await expect(textbox(page, 'Nettoyer le worktree')).toHaveValue('rm -rf node_modules/.cache');
  await expectAccessible(page);

  await type(page, 'Préparer le worktree', 'pnpm install\ncp ../.env .env');
  await expect(textbox(page, 'Préparer le worktree')).toBeEnabled();
  const projectId = run.path.split('/')[2];
  await expect(async () => {
    const stored = await (await page.request.get(`/api/projects/${projectId}/settings`)).text();
    expect(stored).toContain('"worktreeCommands":{');
    expect(stored).not.toMatch(/pnpm|\.env|rm -rf/);
  }).toPass();
  await page.reload();
  await show(page, 'Worktree', viewport);
  await expect(textbox(page, 'Préparer le worktree')).toHaveValue('pnpm install\ncp ../.env .env');
  await expect(textbox(page, 'Nettoyer le worktree')).toHaveValue('rm -rf node_modules/.cache');
});

/** PARAM-3, US-82: push off for the Projet only, changed for it, kept after a reload, then back to the account. */
test('push: off for the Projet only, kept after a reload, back to the account', async ({ page, scenario, viewport }) => {
  await scenario('parametres-projet');
  await show(page, 'Notifications', viewport);
  await expect(push(page)).toHaveAttribute('aria-checked', 'true');
  await expect(row(page, 'Notifications push')).toContainText('Hérité du compte');

  await push(page).click();
  await expect(push(page)).toHaveAttribute('aria-checked', 'false');
  await expect(row(page, 'Notifications push')).toContainText('Modifié pour ce Projet');
  await page.reload();
  await show(page, 'Notifications', viewport);
  await expect(push(page)).toHaveAttribute('aria-checked', 'false');
  const account = await (await page.request.get('/api/settings')).json();
  expect(account.notifications.push).toBe(true);

  await page.getByRole('button', { name: 'Revenir au compte pour Notifications push' }).click();
  await expect(push(page)).toHaveAttribute('aria-checked', 'true');
  await expect(row(page, 'Notifications push')).toContainText('Hérité du compte');
});
