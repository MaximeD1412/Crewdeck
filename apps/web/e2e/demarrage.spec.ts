import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/** What the binary sends for its machine (`crewdeck-runner link`), Moteurs found on `PATH`. */
const MACHINE = { machine: 'atelier-pc', os: 'linux', arch: 'amd64', wsl: false, runnerVersion: '0.4.2', engines: ['claude'] };

/** The code of the command the page shows: its short id and its secret. */
const codeOf = async (page: Page): Promise<{ shortId: string; secret: string }> => {
  const block = page.locator('cd-page-demarrage cd-code-block');
  await expect(block).toContainText(/--link [0-9A-Z]{4}-[0-9A-Z]{26}/);
  const [, shortId, secret] = /--link ([0-9A-Z]{4})-([0-9A-Z]{26})/.exec((await block.locator('code').textContent()) ?? '') ?? [];
  return { shortId: shortId ?? '', secret: secret ?? '' };
};

/** The binary and `install.sh`: no session, the server's routes for them. */
const binary = async (playwright: { request: { newContext(options: { baseURL?: string }): Promise<APIRequestContext> } }, baseURL: string | undefined) =>
  playwright.request.newContext({ baseURL: baseURL ?? 'http://localhost:4200' });

const banner = (page: Page) => page.locator('cd-page-demarrage cd-banner');

test.describe('« Premiers pas », the Runner (US-2)', () => {
  test('a Pilote at the Runner’s step lands on /demarrage, whose code links the Runner; its secret never reaches the server', async ({
    page,
    playwright,
    baseURL,
    scenario,
    expectAccessible,
  }) => {
    const sent: string[] = [];
    page.on('request', (request) => sent.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`));
    await scenario('demarrage');
    await page.goto('/a-toi');
    await expect(page).toHaveURL('/demarrage');

    const demarrage = page.locator('cd-page-demarrage');
    await expect(demarrage.getByRole('heading', { level: 1, name: 'Installe le Runner' })).toBeVisible();
    await expect(page.locator('cd-cadre').getByRole('navigation', { name: 'Menu principal' })).toHaveCount(0);
    const { shortId, secret } = await codeOf(page);
    await expect(demarrage.getByText('En attente du Runner…')).toBeVisible();
    await expect(demarrage.getByText('Cette page passe à la suite dès que le Runner se relie à ton compte.')).toBeVisible();
    await expect(demarrage.locator('cd-check-row')).toContainText(`code ${shortId}`);
    await expect(demarrage.getByText('Ce qui reste chez toi')).toBeVisible();
    await expectAccessible(page);

    await demarrage.getByRole('tab', { name: 'macOS' }).click();
    await expect(demarrage.getByRole('tab', { name: 'macOS' })).toHaveAttribute('aria-selected', 'true');
    expect((await codeOf(page)).shortId).toBe(shortId);

    const runner = await binary(playwright, baseURL);
    const linked = await runner.post('/api/runner/link', { data: { ...MACHINE, shortId } });
    expect(linked.status(), await linked.text()).toBe(202);
    const { linkId } = (await linked.json()) as { linkId: string };
    expect((await runner.post(`/api/runner/link/${linkId}/pairing`, { data: { pairing: {} } })).status()).toBe(204);

    // The page confirms the pending code; the binary gets its token once.
    await expect(demarrage.getByRole('heading', { level: 1, name: 'Runner relié' })).toBeVisible();
    await expect(demarrage.locator('cd-key-value')).toContainText('atelier-pc');
    await expect(demarrage.locator('cd-key-value')).toContainText('Linux · amd64');
    await expect(demarrage.locator('cd-key-value')).toContainText('Runner 0.4.2');
    const status = (await (await runner.get(`/api/runner/link/${linkId}`)).json()) as { state: string; token?: string };
    expect(status).toMatchObject({ state: 'linked', token: expect.any(String) });
    expect(await (await runner.get(`/api/runner/link/${linkId}`)).json()).not.toHaveProperty('token');
    await runner.dispose();

    expect(sent.some((line) => line.includes(`/api/runner/link-codes/${linkId}/confirm`))).toBe(true);
    expect(sent.filter((line) => line.includes(secret))).toEqual([]);

    // « Continuer » on to the Comptes IA, which wait for the Runner to report a usable one.
    await demarrage.getByRole('button', { name: 'Continuer' }).click();
    await expect(demarrage.getByRole('heading', { level: 1, name: 'Connecte tes Comptes IA' })).toBeVisible();
    await expect(banner(page)).toContainText('Aucun Moteur utilisable');
    await expect(demarrage.getByRole('button', { name: 'Continuer' })).toBeDisabled();
  });

  test('an expired code shows its Banner and a new command', async ({ page, scenario, expectAccessible }) => {
    await scenario('demarrage-liaison-echouee');

    await expect(page.getByRole('heading', { level: 1, name: 'La liaison a échoué' })).toBeVisible();
    await expect(banner(page)).toContainText('Code de liaison expiré');
    await expect(banner(page)).toContainText('Le code 7KQ4 a expiré');
    expect((await codeOf(page)).shortId).not.toBe('7KQ4');
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
    await expectAccessible(page);
  });

  for (const [reason, title, fail] of [
    ['no-engine', 'Aucun Moteur trouvé', (r: APIRequestContext, shortId: string) => r.post('/api/runner/link', { data: { ...MACHINE, engines: [], shortId } })],
    [
      'unsupported-system',
      'Système non pris en charge',
      (r: APIRequestContext, shortId: string) =>
        r.post('/api/runner/link-failures', { data: { shortId, reason: 'unsupported-system', os: 'FreeBSD', arch: 'riscv64' } }),
    ],
    [
      'already-used',
      'Code de liaison déjà utilisé',
      async (r: APIRequestContext, shortId: string) => {
        await r.post('/api/runner/link', { data: { ...MACHINE, shortId } });
        return r.post('/api/runner/link', { data: { ...MACHINE, machine: 'autre-pc', shortId } });
      },
    ],
  ] as const) {
    test(`a link that failed (${reason}) shows its Banner and a new command, which « Réessayer » draws again`, async ({
      page,
      playwright,
      baseURL,
      scenario,
    }) => {
      await scenario('demarrage');
      const first = await codeOf(page);
      const runner = await binary(playwright, baseURL);
      const failed = await fail(runner, first.shortId);
      expect(failed.ok(), await failed.text()).toBe(reason === 'unsupported-system');
      await runner.dispose();

      await expect(banner(page)).toContainText(title);
      await expect.poll(async () => (await codeOf(page)).shortId).not.toBe(first.shortId);
      const second = await codeOf(page);

      await page.getByRole('button', { name: 'Réessayer' }).click();
      await expect(banner(page)).toHaveCount(0);
      await expect.poll(async () => (await codeOf(page)).shortId).not.toBe(second.shortId);
      await expect(page.getByRole('heading', { level: 1, name: 'Installe le Runner' })).toBeVisible();
    });
  }

  test('a linked Runner online: « Runner relié » with its machine, its system and its version', async ({ page, scenario, expectAccessible }) => {
    await scenario('demarrage-runner-relie');

    const demarrage = page.locator('cd-page-demarrage');
    await expect(demarrage.getByRole('heading', { level: 1, name: 'Runner relié' })).toBeVisible();
    await expect(banner(page)).toContainText('Runner en ligne');
    await expect(demarrage.locator('cd-key-value')).toContainText('atelier-pc');
    await expect(demarrage.locator('cd-key-value')).toContainText('Windows (WSL) · amd64');
    await expect(demarrage.locator('cd-key-value')).toContainText('Runner 0.4.2');
    await expect(demarrage.locator('cd-code-block')).toHaveCount(0);
    await expectAccessible(page);
  });
});

/** What the Runner reports once a Compte IA is connected on the machine (`crewdeck-runner login claude`). */
const CLAUDE_CONNECTED = {
  engine: 'claude-code',
  installed: true,
  version: '2.1.3',
  knownVersion: true,
  account: { kind: 'subscription', state: 'connected' },
  models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true }],
  features: { interrupt: true, resume: true, questions: true, permissions: true },
};

const card = (page: Page, engine: string) => page.locator(`cd-page-demarrage cd-card[data-engine=${engine}]`);

test.describe('« Premiers pas », the Comptes IA (US-38)', () => {
  test('each Moteur as the Runner sees it: its Compte IA, its models usable or why not', async ({ page, scenario, expectAccessible }) => {
    await scenario('demarrage-comptes-ia');

    const demarrage = page.locator('cd-page-demarrage');
    await expect(demarrage.getByRole('heading', { level: 1, name: 'Connecte tes Comptes IA' })).toBeVisible();
    await expect(card(page, 'claude-code')).toContainText('connecté · abonnement');
    await expect(card(page, 'claude-code').locator('cd-list-row')).toHaveCount(3);
    await expect(card(page, 'claude-code').locator('cd-list-row').nth(2)).toContainText('indisponible avec cet abonnement');
    await expect(card(page, 'codex')).toContainText('connexion requise');
    await expect(card(page, 'codex').locator('cd-code-block')).toContainText('crewdeck-runner login codex');
    await expect(banner(page)).toHaveCount(0);
    await expect(demarrage.getByRole('button', { name: 'Continuer' })).toBeEnabled();
    await expectAccessible(page);
  });

  test('no Moteur usable: the Banner and « Continuer » disabled, enabled as soon as the Runner reports one, without a reload', async ({
    page,
    baseURL,
    scenario,
    expectAccessible,
  }) => {
    await scenario('demarrage-comptes-ia-aucun');

    const demarrage = page.locator('cd-page-demarrage');
    const next = demarrage.getByRole('button', { name: 'Continuer' });
    await expect(banner(page)).toContainText('Aucun Moteur utilisable');
    await expect(card(page, 'claude-code').locator('cd-code-block')).toContainText('crewdeck-runner login claude');
    await expect(card(page, 'codex').locator('cd-code-block')).toContainText('crewdeck-runner login codex');
    await expect(next).toBeDisabled();
    await expectAccessible(page);

    // The API refuses it too, whatever the page shows.
    const origin = new URL(baseURL ?? 'http://localhost:4200').origin;
    const seq = ((await (await page.request.get('/api/state')).json()) as { seq: number }).seq;
    const refused = await page.request.post('/api/me/getting-started/advance', { data: { from: 'ai-accounts', seq }, headers: { origin } });
    expect(refused.status()).toBe(422);
    expect(await refused.json()).toMatchObject({ code: 'getting-started.no-usable-engine' });

    let reloaded = false;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloaded = true;
    });
    const reported = await page.request.post('/api/testing/runner/capabilities', { data: { engines: [CLAUDE_CONNECTED] }, headers: { origin } });
    expect(reported.status(), await reported.text()).toBe(204);

    await expect(next).toBeEnabled();
    await expect(banner(page)).toHaveCount(0);
    await expect(card(page, 'claude-code')).toContainText('connecté · abonnement');
    expect(reloaded).toBe(false);

    await next.click();
    await expect(demarrage.getByRole('heading', { level: 1, name: 'Choisis tes Projets' })).toBeVisible();
    await demarrage.getByRole('button', { name: 'Continuer' }).click();
    await expect(page).toHaveURL('/a-toi');
  });
});
