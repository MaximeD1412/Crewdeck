import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/** The library's previews of the Composant opened: each example's element, in its figure. */
const previews = (page: Page, tag: string) =>
  page.locator('cd-card').filter({ has: page.getByRole('heading', { level: 2, name: /^Aperçu/ }) }).locator(`figure ${tag}`);

/**
 * What each preview shows once rendered, read through its shadow roots: a
 * Composant of the Process canvas (UI-8) is drawn, not only defined.
 */
const SHOWS: Record<string, { tag: string; examples: number; shows: (previews: Locator) => Locator }> = {
  ProcessCanvas: { tag: 'cd-process-canvas', examples: 4, shows: (previews) => previews.getByRole('article', { name: /^Étape \/ Analyse/ }) },
  Phase: { tag: 'cd-phase', examples: 3, shows: (previews) => previews.getByRole('region', { name: 'Phase / Idée' }) },
  StepCard: { tag: 'cd-step-card', examples: 6, shows: (previews) => previews.filter({ hasText: 'aucun Outil' }) },
  Port: { tag: 'cd-port', examples: 6, shows: (previews) => previews.filter({ hasText: 'rien ne l’alimente' }) },
  ToolChip: { tag: 'cd-tool-chip', examples: 5, shows: (previews) => previews.filter({ hasText: 'Serveur MCP' }) },
  LoopBack: { tag: 'cd-loop-back', examples: 2, shows: (previews) => previews.getByText('Retour · 3 fois au plus') },
  Toast: { tag: 'cd-toast', examples: 3, shows: (previews) => previews.getByRole('status') },
  Cadre: { tag: 'cd-cadre', examples: 5, shows: (previews) => previews.getByRole('link', { name: /^À toi/ }) },
};

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** An arrow of the canvas as drawn: its ends, its points sampled along the path (page px), and the boxes of its Étapes. */
interface DrawnArrow {
  from: string;
  to: string;
  points: { x: number; y: number }[];
}

/** Reads the first canvas's arrows and obstacles (cards, Phase heads, Retours' badges), in page px. */
const drawing = (canvas: Locator) =>
  canvas.evaluate((host) => {
    const root = host.shadowRoot as ShadowRoot;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const cards: Record<string, Box> = Object.fromEntries([...root.querySelectorAll('cd-step-card[data-step]')].map((card) => [card.getAttribute('data-step'), box(card)]));
    const heads = [...root.querySelectorAll('cd-phase')].map((phase) => box(phase.shadowRoot?.querySelector('header') as Element));
    const badges = [...root.querySelectorAll('cd-loop-back')].map(box);
    const arrows = [...root.querySelectorAll<SVGPathElement>('path.wire.arrow')].map((path) => {
      const matrix = path.getScreenCTM() as DOMMatrix;
      const length = path.getTotalLength();
      const points = Array.from({ length: Math.ceil(length) + 1 }, (_, i) => {
        const at = path.getPointAtLength(Math.min(i, length));
        return { x: at.x * matrix.a + at.y * matrix.c + matrix.e, y: at.x * matrix.b + at.y * matrix.d + matrix.f };
      });
      return { from: path.dataset['from'] as string, to: path.dataset['to'] as string, points };
    });
    return { cards, heads, badges, arrows };
  });

/** Whether `p` lies strictly inside `box`, its edges `inset` px in. */
const inside = (p: { x: number; y: number }, box: Box, inset = 1.5) =>
  p.x > box.l + inset && p.x < box.r - inset && p.y > box.t + inset && p.y < box.b - inset;

test.describe('the Composants of the Process canvas in the library (/parametres/composants?c=<Name>)', () => {
  for (const [name, { tag, examples, shows }] of Object.entries(SHOWS)) {
    test(`previews every example of ${name}, accessible`, async ({ page, scenario, expectAccessible }) => {
      await scenario(`composants-${name.toLowerCase()}`);

      await expect(page.getByRole('heading', { level: 1, name: 'Bibliothèque de Composants' })).toBeVisible();
      await expect(previews(page, tag)).toHaveCount(examples);
      await expect(shows(previews(page, tag)).first()).toBeVisible();
      await expectAccessible(page);
    });
  }

  test('« le Process Crewdeck » draws every arrow from its Sortie, rightwards, to its Entrée, from the left, across no card, head nor badge', async ({
    page,
    scenario,
  }) => {
    await scenario('composants-processcanvas');
    const canvas = previews(page, 'cd-process-canvas').first();
    await expect(canvas.locator('path.wire.arrow')).toHaveCount(25);
    await expect(canvas.locator('path.wire.loop')).toHaveCount(4);
    await expect(canvas.locator('cd-loop-back.unrouted')).toHaveCount(0);

    const { cards, heads, badges, arrows } = await drawing(canvas);
    expect(Object.keys(cards)).toHaveLength(17);
    expect(arrows).toHaveLength(25);
    for (const arrow of arrows as DrawnArrow[]) {
      const source = cards[arrow.from.split('.')[0] as string] as Box;
      const target = cards[arrow.to.split('.')[0] as string] as Box;
      const [first, second] = arrow.points;
      const [last, before] = [arrow.points.at(-1), arrow.points.at(-2)];
      expect(first?.x, `${arrow.from} part du bord droit`).toBeCloseTo(source.r, 0);
      expect(second!.x - first!.x, `${arrow.from} part vers la droite`).toBeGreaterThan(0);
      expect(last?.x, `${arrow.to} arrive au bord gauche`).toBeCloseTo(target.l, 0);
      expect(last!.x - before!.x, `${arrow.to} arrive par la gauche`).toBeGreaterThan(0);
      const crossed = arrow.points.flatMap((point) => [
        ...Object.entries(cards).filter(([, card]) => inside(point, card)).map(([id]) => id),
        ...heads.filter((head) => inside(point, head)).map(() => 'une tête de Phase'),
        ...badges.filter((badge) => inside(point, badge)).map(() => 'un Retour'),
      ]);
      expect([...new Set(crossed)], `${arrow.from} → ${arrow.to} traverse`).toEqual([]);
    }
  });
});
