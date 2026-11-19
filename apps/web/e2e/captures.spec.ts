/**
 * The captures of a visual review, written by `scripts/captures.sh`:
 * `CAPTURES_SCENARIOS` (comma-separated scenario names, the ids of
 * `design/screens.json`) into `CAPTURES_DIR`, once per project (390 and 1280 px).
 */
import type { Page } from '@playwright/test';
import { openConfirm } from './confirm.js';
import { expect, test } from './fixtures.js';
import { linkFirstAppareil } from './runner-link.js';
import { routeSocket } from './socket.js';
import { becomeTrustedDevice } from './trusted-device.js';

/** The nav's « Notifications » opened, then back at the top: the full-page shot keeps its sticky columns in place at 1280 px. */
const openNotifications = async (page: Page) => {
  await page.getByRole('navigation', { name: 'Paramètres / Sections' }).getByRole('link', { name: 'Notifications' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
};

/** The Paramètres' « Appareils », this browser linked first: its first trusted Appareil (E2E-3). */
const appareils = async (page: Page) => {
  await linkFirstAppareil(page, undefined);
  await page.goto('/parametres');
  await page.getByRole('navigation', { name: 'Paramètres / Sections' }).getByRole('link', { name: 'Appareils' }).click();
  await expect(page.locator('cd-page-parametres > cd-card[slot=devices]')).toBeVisible();
};

/** What a scenario's capture shows beyond its page: a sheet or a dialog opened, by width. */
const PREPARE: Readonly<Record<string, (page: Page, width: number) => Promise<void>>> = {
  // The socket cut once live, at the mockup's time of the loss.
  'a-toi-resynchronisation': async (page) => {
    await page.clock.setFixedTime(new Date('2026-11-11T15:12:00+01:00'));
    const socket = await routeSocket(page);
    await page.reload();
    await expect(page.getByText('Runner hors ligne').filter({ visible: true })).toBeVisible();
    await socket.cut();
    await expect(page.locator('#app > cd-cadre > cd-banner[slot=banner]')).toContainText('15:12');
  },
  // The core's confirmation of an Action sensible, over the library (CORE-7).
  'confirm-dialog': openConfirm,
  'a-toi-menu-plus': async (page, width) => {
    if (width < 1280) await page.getByRole('button', { name: 'Plus' }).click();
  },
  // The form sent: its go Banner in place of the field (CORE-9).
  'connexion-lien-envoye': async (page) => {
    const connexion = page.locator('cd-page-connexion');
    await connexion.getByRole('textbox', { name: 'Ton adresse e-mail' }).fill('pilote@example.com');
    await connexion.getByRole('button', { name: 'Recevoir un lien' }).click();
    await expect(connexion.getByText('Lien envoyé à pilote@example.com')).toBeVisible();
  },
  'connexion-lien': async (page) => {
    await expect(page.locator('cd-page-connexion-lien').getByRole('button', { name: 'Se connecter' })).toBeVisible();
  },
  // The page draws its code once the snapshot is there: its command shown.
  demarrage: async (page) => {
    await expect(page.locator('cd-page-demarrage cd-code-block')).toContainText('--link');
  },
  'demarrage-liaison-echouee': async (page) => {
    await expect(page.locator('cd-page-demarrage cd-code-block')).toContainText('--link');
  },
  'demarrage-runner-relie': async (page) => {
    await expect(page.locator('cd-page-demarrage cd-banner')).toContainText('Runner en ligne');
  },
  // A new Appareil: the Cadre's Banner, then its dialog with the QR code and the code (E2E-3).
  'appareil-a-approuver': async (page) => {
    await expect(page.locator('#app > cd-cadre > cd-banner[slot=banner]')).toContainText('Cet Appareil ne lit pas encore');
  },
  'appareil-a-approuver-code': async (page) => {
    await page.locator('#app > cd-cadre > cd-banner[slot=banner]').getByRole('button', { name: 'Approuver cet Appareil' }).click();
    await expect(page.getByRole('img', { name: 'QR code de cet Appareil' })).toBeVisible();
    await expect(page.locator('crewdeck-new-device code').first()).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{26}$/);
  },
  appareils,
  'appareils-ajouter': async (page) => {
    await appareils(page);
    await page.locator('cd-page-parametres > cd-card[slot=devices]').getByRole('button', { name: 'Ajouter un Appareil' }).click();
    await expect(page.getByLabel('Colle le code affiché sur le nouvel Appareil')).toBeFocused();
  },
  'demarrage-comptes-ia': async (page) => {
    await expect(page.locator('cd-page-demarrage cd-card[data-engine=claude-code]')).toContainText('connecté · abonnement');
  },
  'demarrage-comptes-ia-aucun': async (page) => {
    await expect(page.locator('cd-page-demarrage cd-banner')).toContainText('Aucun Moteur utilisable');
  },
  // The mockup's two repositories checked: « Suivre 2 Projets ».
  'demarrage-projets': async (page) => {
    const picker = page.locator('cd-page-demarrage cd-repository-picker');
    await picker.getByRole('checkbox', { name: /^octocat\/personal-os\b/ }).check();
    await picker.getByRole('checkbox', { name: /^octocat\/site-mairie\b/ }).check();
    await expect(picker.getByRole('button', { name: 'Suivre 2 Projets' })).toBeEnabled();
  },
  // « Gestion du process » once the snapshot drew its canvas (1280 px; the phone's list is PROCESS-11's).
  ...Object.fromEntries(
    ['process', 'process-manques', 'process-etape', 'process-phase', 'process-sources', 'process-local'].map((name) => [
      name,
      async (page: Page, width: number) => {
        if (width >= 1280) await expect(page.locator('cd-page-process-editor cd-process-canvas cd-step-card').first()).toBeVisible();
      },
    ]),
  ),
  // « Activer la v4 » pressed: its confirmation open over the canvas, the three changes and the work by version (PROCESS-10).
  'process-activation': async (page, width) => {
    if (width < 1280) return;
    await page.locator('cd-page-process-editor cd-page-header').getByRole('button', { name: 'Activer la v4' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Activer la v4 du Process de Site mairie ?' })).toContainText('la Conception « Actualités » sur la v2');
  },
  // The catalogue opened under « Étape », « Développement » chosen (1280 px: the header's actions are the editor's).
  'process-catalogue': async (page, width) => {
    if (width < 1280) return;
    const editor = page.locator('cd-page-process-editor');
    await expect(editor.locator('cd-process-canvas cd-step-card').first()).toBeVisible();
    await editor.getByRole('button', { name: 'Étape', exact: true }).click();
    await expect(editor.getByRole('menu', { name: 'Ajouter dans « Développement »' })).toBeVisible();
  },
  projets: async (page) => {
    await expect(page.locator('cd-page-projets cd-list-row')).toHaveCount(4);
  },
  // « Rôles et modèles » once the snapshot gave the Comptes IA: the Idée on Sonnet, as the mockup.
  parametres: async (page) => {
    await expect(page.getByRole('combobox', { name: 'Moteur et modèle du Rôle Idée' }).filter({ visible: true })).toHaveValue('claude-code:claude-sonnet-5-5');
  },
  // « Notifications » (ATOI-4): its section opened, as a link of the nav does (on the phone, the section alone).
  'parametres-notifications': async (page) => {
    await openNotifications(page);
    await expect(page.getByRole('button', { name: 'Activer sur cet appareil' })).toBeVisible();
  },
  // A browser without PushManager, an iPhone outside the home-screen app: the help instead of the button.
  'parametres-notifications-iphone': async (page) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, 'PushManager');
    });
    await page.reload();
    await openNotifications(page);
    await expect(page.getByText('Sur iPhone, ajoute Crewdeck à l’écran d’accueil', { exact: false })).toBeVisible();
  },
  // On the trusted Appareil, the Code on Codex once the snapshot is there; at 1280 px, the worktree Commandes opened.
  'parametres-projet': async (page, width) => {
    await becomeTrustedDevice(page);
    await expect(page.getByRole('combobox', { name: 'Moteur et modèle du Rôle Code' }).filter({ visible: true })).toHaveValue('codex:gpt-5.5');
    if (width >= 1280) await expect(page.getByRole('textbox', { name: 'Préparer le worktree' })).toHaveValue('pnpm install --frozen-lockfile');
  },
  // The Idées opened by the trusted Appareil the scenario installs.
  idees: async (page) => {
    await expect(page.locator('cd-page-idees cd-idea-row').first()).toContainText('Prévenir quand une Planification');
  },
  // « Noter une Idée » opened over the list, as the mockup.
  'idees-nouvelle': async (page) => {
    await expect(page.locator('cd-page-idees cd-idea-row').first()).toContainText('Prévenir quand une Planification');
    await page.locator('cd-page-idees cd-page-header').getByRole('button', { name: 'Noter une Idée' }).click();
    await expect(page.getByRole('dialog', { name: 'Noter une Idée' })).toBeVisible();
  },
  'idees-vide': async (page) => {
    await expect(page.locator('cd-page-idees cd-empty')).toContainText('Aucune Idée pour l’instant');
  },
  runner: async (page) => {
    await expect(page.locator('cd-page-runner cd-card.runner')).toContainText('en ligne');
    await expect(page.locator('cd-page-runner > cd-usage-card')).toContainText('au rythme actuel');
  },
  'runner-serveurs-mcp': async (page) => {
    await expect(page.locator('cd-page-runner cd-card.mcp cd-list-row')).toHaveCount(2);
  },
  'runner-hors-ligne': async (page) => {
    await expect(page.locator('cd-page-runner cd-card.runner')).toContainText('hors ligne');
    await expect(page.locator('cd-page-runner > cd-usage-card')).toContainText('Dernière mesure');
    await expect(page.locator('#app > cd-cadre > cd-banner[slot=banner] cd-code-block')).toContainText('crewdeck-runner restart');
  },
  // The card « Comptes IA » is filled once the snapshot is there (RUNNER-13).
  'a-toi': async (page) => {
    await expect(page.locator('cd-page-a-toi > cd-usage-card')).toContainText('Au rythme actuel');
  },
  'a-toi-vide': async (page) => {
    await expect(page.locator('cd-page-a-toi > cd-usage-card')).toContainText('Au rythme actuel');
  },
  // « Runner hors ligne » (ATOI-3): its row among the Décisions, and its banner; the Comptes IA as last measured.
  'a-toi-runner-hors-ligne': async (page) => {
    await expect(page.locator('#app > cd-cadre > cd-banner[slot=banner]')).toContainText('Ton Runner ne répond plus');
    await expect(page.locator('cd-page-a-toi cd-decision-row')).toHaveCount(10);
    await expect(page.locator('cd-page-a-toi > cd-usage-card')).toContainText('Dernière mesure');
  },
  // The Session panel over « À toi » (SESSION-2): the conversation the fake Runner relays, opened by the scenario's Appareil.
  session: async (page) => {
    await expect(page.locator('#app > cd-cadre > cd-session[slot=panel]')).toContainText('96 lignes');
  },
  'session-arretee': async (page) => {
    await expect(page.locator('#app > cd-cadre > cd-session[slot=panel]')).toContainText('96 lignes');
    await expect(page.locator('#app > cd-cadre > cd-session[slot=panel]')).toContainText('Session arrêtée par toi à 15:12');
  },
  'session-runner-hors-ligne': async (page) => {
    await expect(page.locator('#app > cd-cadre > cd-session[slot=panel]')).toContainText('Conversation sur ton Runner');
    await expect(page.locator('#app > cd-cadre > cd-banner[slot=banner]')).toContainText('Les sessions reprendront');
  },
  // A question of the agent (SESSION-3), its first option chosen as the mockup shows it.
  'session-question': async (page) => {
    const question = page.locator('#app > cd-cadre > cd-session[slot=panel] cd-question');
    await expect(question).toContainText('Qui peut modifier un événement');
    await question.getByRole('radio', { name: 'Tous les membres de l’agenda' }).check();
  },
  // A `git push` waiting for the Pilote's permission (SESSION-3), its Décision's command read under the panel.
  'session-permission': async (page) => {
    await expect(page.locator('#app > cd-cadre > cd-session[slot=panel] cd-permission-request')).toContainText('git push origin design/agenda-partage');
    await expect(page.locator('cd-page-a-toi cd-decision-row').filter({ hasText: 'Concevoir · Agenda partagé' })).toContainText('Bash : git push');
  },
  // « Maximum de Retours atteint » (PROCESS-6) among the nine Décisions of `a-toi`.
  'a-toi-process': async (page) => {
    await expect(page.locator('cd-page-a-toi cd-decision-row')).toHaveCount(10);
  },
};

/** The scenarios whose capture is the screen, not the whole page: a modal over it. */
const SCREEN_ONLY: ReadonlySet<string> = new Set(['confirm-dialog', 'appareil-a-approuver-code', 'appareils-ajouter', 'idees-nouvelle', 'process-activation']);

const names = (process.env['CAPTURES_SCENARIOS'] ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

test.skip(names.length === 0 || !process.env['CAPTURES_DIR'], 'CAPTURES_SCENARIOS et CAPTURES_DIR : à lancer par scripts/captures.sh');

for (const name of names) {
  test(`capture ${name}`, async ({ page, scenario, capture }) => {
    await scenario(name);
    await page.waitForLoadState('networkidle');
    await PREPARE[name]?.(page, page.viewportSize()?.width ?? 0);
    await capture(page, name, { fullPage: !SCREEN_ONLY.has(name) });
  });
}
