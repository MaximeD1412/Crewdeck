/**
 * The fixtures of every end-to-end spec: `import { test, expect } from './fixtures.js'`.
 *
 * - `scenario(name)`: seeds the server with the scenario (`apps/server/src/testing/scenarios/`),
 *   carries its session cookie, opens its page;
 * - `expectAccessible(page)`: axe, WCAG 2.1 A and AA, no violation;
 * - `capture(page, screenId)`: with `CAPTURES_DIR` set, a full-page PNG
 *   `<CAPTURES_DIR>/<screenId>-<390|1280>.png` (`scripts/captures.sh`); else nothing.
 */
import AxeBuilder from '@axe-core/playwright';
import type { ScenarioRun } from '@crewdeck/contracts';
import { expect, type Page, test as base } from '@playwright/test';
import { join } from 'node:path';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

export interface Fixtures {
  scenario: (name: string) => Promise<ScenarioRun>;
  expectAccessible: (page: Page) => Promise<void>;
  capture: (page: Page, screenId: string) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  scenario: async ({ page, context, baseURL }, use) => {
    await use(async (name) => {
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
    await use(async (page, screenId) => {
      const dir = process.env['CAPTURES_DIR'];
      if (!dir) return;
      const width = testInfo.project.use.viewport?.width;
      if (!width) throw new Error(`le projet ${testInfo.project.name} n'a pas de largeur`);
      await page.screenshot({ path: join(dir, `${screenId}-${width}.png`), fullPage: true, animations: 'disabled' });
    });
  },
});

export { expect };
