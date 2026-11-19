/**
 * The fixtures of every end-to-end spec: `import { test, expect } from './fixtures.js'`.
 *
 * - `scenario(name, { device })`: seeds the server with the scenario (`apps/server/src/testing/scenarios/`),
 *   carries its session cookie, opens its page; the Appareil the scenario trusts
 *   becomes this browser's (IndexedDB `crewdeck-keys`) unless `device: false`;
 * - `expectAccessible(page)`: axe, WCAG 2.1 A and AA, no violation;
 * - `capture(page, screenId, { fullPage })`: with `CAPTURES_DIR` set, a PNG
 *   `<CAPTURES_DIR>/<screenId>-<390|1280>.png` (`scripts/captures.sh`), of the
 *   full page unless `fullPage: false` (a modal over the screen); else nothing.
 */
import AxeBuilder from '@axe-core/playwright';
import type { ScenarioDevice, ScenarioRun } from '@crewdeck/contracts';
import { expect, type Page, test as base } from '@playwright/test';
import { join } from 'node:path';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

export interface Fixtures {
  scenario: (name: string, options?: { device?: boolean }) => Promise<ScenarioRun>;
  expectAccessible: (page: Page) => Promise<void>;
  capture: (page: Page, screenId: string, options?: { fullPage?: boolean }) => Promise<void>;
}

/**
 * Makes the scenario's Appareil this browser's, as a first link leaves it
 * (`apps/web/src/keys/device-store.ts`): its private key imported
 * non-extractable, then the page loaded again to open the vault with it.
 */
const installDevice = async (page: Page, device: ScenarioDevice): Promise<void> => {
  await page.evaluate(async ({ deviceId, privateKey, publicKey, runnerPublicKey }) => {
    const bytes = (text: string) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
    // PKCS #8 of an X25519 private key (RFC 8410): this prefix, then the 32 bytes.
    const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20, ...bytes(privateKey)]);
    const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('crewdeck-keys', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('device');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB'));
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('device', 'readwrite');
      // The Runner's key, as a pairing leaves it, when the scenario's fake Runner relays a Session (SESSION-2).
      transaction.objectStore('device').put({ deviceId, privateKey: key, publicKey: bytes(publicKey), ...(runnerPublicKey ? { runnerPublicKey: bytes(runnerPublicKey) } : {}) }, 'self');
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB'));
    });
    database.close();
  }, device);
  await page.reload();
};

export const test = base.extend<Fixtures>({
  scenario: async ({ page, context, baseURL }, use) => {
    await use(async (name, { device = true } = {}) => {
      // The page's origin, as a page's POST carries it: the server refuses another with a session cookie (CORE-4).
      const origin = new URL(baseURL ?? 'http://localhost:4200').origin;
      const response = await page.request.post(`/api/testing/scenarios/${encodeURIComponent(name)}`, { data: {}, headers: { origin } });
      expect(response.status(), `scénario ${name} : ${await response.text()}`).toBe(200);
      const run = (await response.json()) as ScenarioRun;
      if (run.sessionCookie) {
        const separator = run.sessionCookie.indexOf('=');
        await context.addCookies([
          {
            name: run.sessionCookie.slice(0, separator),
            value: run.sessionCookie.slice(separator + 1),
            url: baseURL ?? 'http://localhost:4200',
            httpOnly: true,
            sameSite: 'Lax',
          },
        ]);
      }
      await page.goto(run.path);
      if (run.device && device) await installDevice(page, run.device);
      return run;
    });
  },

  // Playwright reads the fixtures a fixture needs from its first parameter's destructuring: none here.
  // eslint-disable-next-line no-empty-pattern
  expectAccessible: async ({}, use, testInfo) => {
    await use(async (page) => {
      const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      if (violations.length > 0) {
        await testInfo.attach('axe-violations.json', { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
      }
      expect(
        violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target.join(' ')) })),
        'violations axe (rapport complet en pièce jointe)',
      ).toEqual([]);
    });
  },

  // Playwright reads the fixtures a fixture needs from its first parameter's destructuring: none here.
  // eslint-disable-next-line no-empty-pattern
  capture: async ({}, use, testInfo) => {
    await use(async (page, screenId, { fullPage = true } = {}) => {
      const dir = process.env['CAPTURES_DIR'];
      if (!dir) return;
      const width = testInfo.project.use.viewport?.width;
      if (!width) throw new Error(`le projet ${testInfo.project.name} n'a pas de largeur`);
      await page.screenshot({ path: join(dir, `${screenId}-${width}.png`), fullPage, animations: 'disabled' });
    });
  },
});

export { expect };
