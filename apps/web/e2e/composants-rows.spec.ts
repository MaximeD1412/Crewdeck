import { COMPOSANTS } from '@crewdeck/contracts';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/**
 * Each row Composant's data with a one-line title: no context, summary nor
 * facts, a short title (the examples' wrap in the narrow previews at 390 px).
 */
const ONE_LINE: Record<string, Record<string, unknown>> = {
  DecisionRow: { kind: 'Revue', title: '#42', context: null },
  IdeaRow: { title: 'Export PDF', summary: null, impact: null, effort: null, duplicates: null },
  TicketRow: { title: 'Agenda', context: null },
  AgentRow: { ticket: '#53' },
};

/**
 * The heights of the previews of `tag` once given their one-line data, the
 * rows whose buttons go under their content below 1280 px (an `actions`
 * Emplacement filled, but DecisionRow's, hidden there) left out.
 */
const oneLineHeights = (page: Page, tag: string, data: Record<string, unknown>) =>
  page.evaluate(
    async ({ tag, data }) => {
      // The previews are in the page Composant's shadow root: searched through every one.
      const deep = (root: Document | ShadowRoot): Element[] =>
        [...root.querySelectorAll('*')].flatMap((el) => [...(el.localName === tag ? [el] : []), ...(el.shadowRoot ? deep(el.shadowRoot) : [])]);
      const rows = deep(document).filter(
        (el) => tag === 'cd-decision-row' || !el.querySelector(':scope > [slot=actions]'),
      ) as (HTMLElement & { data: object; updateComplete: Promise<unknown> })[];
      for (const el of rows) el.data = { ...el.data, ...data };
      await Promise.all(rows.map((el) => el.updateComplete));
      return rows.map((el) => ({
        example: el.closest('figure')?.querySelector('figcaption')?.textContent ?? '',
        height: el.shadowRoot?.querySelector('[part=row]')?.getBoundingClientRect().height ?? 0,
      }));
    },
    { tag, data },
  );

test.describe('the row Composants in the library (/parametres/composants?c=<Name>)', () => {
  for (const name of ['DecisionRow', 'IdeaRow', 'TicketRow', 'AgentRow'] as const) {
    test(`previews every example of ${name}, 56 to 72 px tall for a one-line title, accessible`, async ({
      page,
      scenario,
      expectAccessible,
    }) => {
      const { tag, examples } = COMPOSANTS[name];
      await scenario(`composants-${name.toLowerCase()}`);

      await expect(page.getByRole('heading', { level: 1, name: 'Bibliothèque de Composants' })).toBeVisible();
      await expect(page.locator(tag)).toHaveCount(examples.length);
      await expect(page.locator(tag).first()).toBeVisible();
      await expectAccessible(page);

      const heights = await oneLineHeights(page, tag, ONE_LINE[name] ?? {});
      expect(heights.length).toBeGreaterThan(0);
      for (const { example, height } of heights) {
        expect(height, example).toBeGreaterThanOrEqual(56);
        expect(height, example).toBeLessThanOrEqual(72);
      }
    });
  }
});
