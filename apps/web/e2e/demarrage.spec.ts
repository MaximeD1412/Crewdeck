import type { BrowserPairing } from '@crewdeck/contracts';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { binary, codeOf, MACHINE, proof, runnerPairing, secretBytes, x25519PublicKey } from './runner-link.js';

const banner = (page: Page) => page.locator('cd-page-demarrage cd-banner');

test.describe('« Premiers pas », the Runner (US-2)', () => {
  test('a Pilote at the Runner’s step lands on /demarrage, whose code links the Runner through both proofs; its secret never reaches the server', async ({
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
    const code = await codeOf(page);
    const { shortId, secret } = code;
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
    const { linkId, browserPairing } = (await linked.json()) as { linkId: string; browserPairing: BrowserPairing };
    expect(browserPairing.deviceName).toMatch(/ sur /);
    const pairing = runnerPairing(code, browserPairing);
    expect((await runner.post(`/api/runner/link/${linkId}/pairing`, { data: { pairing } })).status()).toBe(204);

    // The page confirms the pending code; the binary gets its token once.
    await expect(demarrage.getByRole('heading', { level: 1, name: 'Runner relié' })).toBeVisible();
    await expect(demarrage.locator('cd-key-value')).toContainText('atelier-pc');
    await expect(demarrage.locator('cd-key-value')).toContainText('Linux · amd64');
    await expect(demarrage.locator('cd-key-value')).toContainText('Runner 0.4.2');
    const status = (await (await runner.get(`/api/runner/link/${linkId}`)).json()) as { state: string; token?: string; pairing?: { proof: string } };
    expect(status).toMatchObject({ state: 'linked', token: expect.any(String), pairing: { vaultKeyVersion: 1 } });
    // The page proved the same secret over the same two keys, the other way round.
    expect(status.pairing?.proof).toBe(proof('device', secretBytes(secret), shortId, browserPairing.devicePublicKey, pairing.runnerPublicKey));
    expect(await (await runner.get(`/api/runner/link/${linkId}`)).json()).not.toHaveProperty('token');
    await runner.dispose();

    expect(sent.some((line) => line.includes(`/api/runner/link-codes/${linkId}/confirm`))).toBe(true);
    expect(sent.filter((line) => line.includes(secret) || line.includes(secretBytes(secret).toString('base64url')))).toEqual([]);
    // The browser's Appareil, trusted now, opens its own wrap of the vault key.
    expect(sent.some((line) => /GET \S+\/api\/devices\/[^/]+\/vault-key-wrap/.test(line))).toBe(true);

    // « Continuer » through the Comptes IA and the Projets, then « À toi ».
    await demarrage.getByRole('button', { name: 'Continuer' }).click();
    await expect(demarrage.getByRole('heading', { level: 1, name: 'Connecte tes Comptes IA' })).toBeVisible();
    await demarrage.getByRole('button', { name: 'Continuer' }).click();
    await expect(demarrage.getByRole('heading', { level: 1, name: 'Choisis tes Projets' })).toBeVisible();
    await demarrage.getByRole('button', { name: 'Continuer' }).click();
    await expect(page).toHaveURL('/a-toi');
  });

  test('a Runner’s key the server swapped: the page refuses its proof, shows its Banner and a new command; the binary reads why', async ({
    page,
    playwright,
    baseURL,
    scenario,
  }) => {
    const sent: string[] = [];
    page.on('request', (request) => sent.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`));
    await scenario('demarrage');
    const code = await codeOf(page);
    const runner = await binary(playwright, baseURL);
    const { linkId, browserPairing } = (await (await runner.post('/api/runner/link', { data: { ...MACHINE, shortId: code.shortId } })).json()) as {
      linkId: string;
      browserPairing: BrowserPairing;
    };
    // The proof the Runner computed over its key, the key the server put in its place.
    const swapped = { ...runnerPairing(code, browserPairing), runnerPublicKey: x25519PublicKey() };
    expect((await runner.post(`/api/runner/link/${linkId}/pairing`, { data: { pairing: swapped } })).status()).toBe(204);

    await expect(banner(page)).toContainText('Preuve de liaison refusée');
    await expect.poll(async () => (await codeOf(page)).shortId).not.toBe(code.shortId);
    expect(await (await runner.get(`/api/runner/link/${linkId}`)).json()).toEqual({ state: 'failed', reason: 'pairing-mismatch' });
    await runner.dispose();
    expect(sent.filter((line) => line.includes(`/api/runner/link-codes/${linkId}/confirm`))).toEqual([]);
    expect(sent.filter((line) => line.includes(code.secret))).toEqual([]);
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
