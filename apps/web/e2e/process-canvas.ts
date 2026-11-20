import type { Locator, Page } from '@playwright/test';

/** The gestures of « Gestion du process »'s canvas at 1280 px, as the mouse makes them. */
export const editor = (page: Page) => page.locator('cd-page-process-editor');
export const canvas = (page: Page) => editor(page).locator('cd-process-canvas');
export const card = (page: Page, stepId: string) => canvas(page).locator(`cd-step-card[data-step="${stepId}"]`);
export const port = (page: Page, stepId: string, portId: string, dir: 'in' | 'out') =>
  card(page, stepId).locator(`cd-port[data-port="${portId}"][data-dir="${dir}"]`);

const centre = async (target: Locator) => {
  const box = await target.boundingBox();
  if (!box) throw new Error(`nothing to drag at ${target.toString()}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Presses on `from`, moves past the canvas's threshold, then onto `to`'s centre and releases there. */
const dragOnto = async (page: Page, from: Locator, to: Locator) => {
  const start = await centre(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 12, { steps: 3 });
  const end = await centre(to);
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
};

/** The whole Process in view, the next frame drawn. */
export const seeAll = async (page: Page) => {
  await canvas(page).getByRole('button', { name: 'Tout voir' }).click();
  await page.waitForTimeout(200);
};

/** Draws an arrow from a Sortie onto an Entrée. */
export const dragArrow = (page: Page, from: { stepId: string; portId: string }, to: { stepId: string; portId: string }) =>
  dragOnto(page, port(page, from.stepId, from.portId, 'out'), port(page, to.stepId, to.portId, 'in'));

/** Draws a Retour from an Étape's handle onto another Étape. */
export const dragLoopBack = (page: Page, from: string, to: string) => dragOnto(page, card(page, from).locator('.handle'), card(page, to).locator('article'));
