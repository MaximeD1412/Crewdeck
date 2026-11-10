import { expect, test } from './fixtures.js';

test('the blank scenario opens the page, accessible', async ({ page, scenario, expectAccessible }) => {
  const run = await scenario('blank');

  expect(run).toEqual({ name: 'blank', path: '/', sessionCookie: null });
  await expect(page).toHaveTitle('Crewdeck');
  // No route yet: the router renders its page Composant for `/`.
  await expect(page.locator('#app > *')).toHaveCount(1);
  await expectAccessible(page);
});
