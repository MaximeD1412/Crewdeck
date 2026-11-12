/**
 * The binary's side of `crewdeck-runner link` (US-2), for the specs that
 * need a Runner linked or a first trusted Appareil: the page's command read,
 * the Runner's pairing computed here from its secret, as the binary does.
 */
import type { BrowserPairing, RunnerPairing } from '@crewdeck/contracts';
import { type APIRequestContext, expect, type Page, request } from '@playwright/test';
import { createHmac, generateKeyPairSync } from 'node:crypto';

/** What the binary sends for its machine (`crewdeck-runner link`), Moteurs found on `PATH`. */
export const MACHINE = { machine: 'atelier-pc', os: 'linux', arch: 'amd64', wsl: false, runnerVersion: '0.4.2', engines: ['claude'] };

/** The code of the command the page shows: its short id and its secret. */
export const codeOf = async (page: Page): Promise<{ shortId: string; secret: string }> => {
  const block = page.locator('cd-page-demarrage cd-code-block');
  await expect(block).toContainText(/--link [0-9A-Z]{4}-[0-9A-Z]{26}/);
  const [, shortId, secret] = /--link ([0-9A-Z]{4})-([0-9A-Z]{26})/.exec((await block.locator('code').textContent()) ?? '') ?? [];
  return { shortId: shortId ?? '', secret: secret ?? '' };
};

/** The binary and `install.sh`: no session, the server's routes for them. */
export const binary = async (playwright: { request: { newContext(options: { baseURL?: string }): Promise<APIRequestContext> } }, baseURL: string | undefined) =>
  playwright.request.newContext({ baseURL: baseURL ?? 'http://localhost:4200' });

/** `PAIRING_PROOF_LABELS` of the contracts, literal: a spec reads no package's build. */
const PAIRING_PROOF_LABELS = { runner: 'crewdeck/v1/link/runner', device: 'crewdeck/v1/link/device' } as const;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The secret's bytes from its Crockford base32 in the command, as `crewdeck-runner link` reads it. */
export const secretBytes = (base32: string): Buffer => {
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of base32) {
    value = ((value << 5) | CROCKFORD.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

/** `HMAC-SHA256(secret, label ‖ shortId ‖ own key ‖ peer's key)`, base64url (`docs/security/e2e.md`). */
export const proof = (side: keyof typeof PAIRING_PROOF_LABELS, secret: Buffer, shortId: string, own: string, peer: string): string =>
  createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(PAIRING_PROOF_LABELS[side]), Buffer.from(shortId, 'ascii'), Buffer.from(own, 'base64url'), Buffer.from(peer, 'base64url')]))
    .digest('base64url');

export const x25519PublicKey = (): string => generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x ?? '';

/** The Runner's pairing for the page's key, from the command's secret: what `crewdeck-runner link` sends. */
export const runnerPairing = (code: { shortId: string; secret: string }, browser: BrowserPairing, runnerPublicKey = x25519PublicKey()): RunnerPairing => ({
  runnerPublicKey,
  proof: proof('runner', secretBytes(code.secret), code.shortId, runnerPublicKey, browser.devicePublicKey),
});

/**
 * Links a Runner from the page on `/demarrage`, which becomes the Pilote's
 * first trusted Appareil, its vault open; then « Continuer » through the
 * getting started, to « À toi ».
 */
export const linkFirstAppareil = async (page: Page, baseURL: string | undefined): Promise<void> => {
  const code = await codeOf(page);
  const runner = await request.newContext({ baseURL: baseURL ?? 'http://localhost:4200' });
  const linked = await runner.post('/api/runner/link', { data: { ...MACHINE, shortId: code.shortId } });
  expect(linked.status(), await linked.text()).toBe(202);
  const { linkId, browserPairing } = (await linked.json()) as { linkId: string; browserPairing: BrowserPairing };
  expect((await runner.post(`/api/runner/link/${linkId}/pairing`, { data: { pairing: runnerPairing(code, browserPairing) } })).status()).toBe(204);
  await runner.dispose();
  const demarrage = page.locator('cd-page-demarrage');
  await expect(demarrage.getByRole('heading', { level: 1, name: 'Runner relié' })).toBeVisible();
  for (const next of ['Connecte tes Comptes IA', 'Choisis tes Projets']) {
    await demarrage.getByRole('button', { name: 'Continuer' }).click();
    await expect(demarrage.getByRole('heading', { level: 1, name: next })).toBeVisible();
  }
  await demarrage.getByRole('button', { name: 'Continuer' }).click();
  await expect(page).toHaveURL('/a-toi');
};
