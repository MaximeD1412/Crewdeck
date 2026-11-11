import { defineScenario } from './define.js';

/**
 * The Cadre and its « Plus » sheet (`design/screens.json`: `a-toi`, state
 * `menu-plus`), around the library page opened on MenuItem: the « À toi »
 * page under the sheet is ATOI-1's. The captures open the sheet at 390
 * (`apps/web/e2e/captures.spec.ts`). Nothing seeded.
 */
export const menuPlus = defineScenario({
  name: 'a-toi-menu-plus',
  path: '/parametres/composants?c=MenuItem',
  seed: () => ({}),
});
