import { defineScenario } from './define.js';
import { signInPilot } from './sign-in.js';

/**
 * The Cadre and its « Plus » sheet (`design/screens.json`: `a-toi`, state
 * `menu-plus`), around the library page opened on MenuItem: the « À toi »
 * page under the sheet is ATOI-1's. The captures open the sheet at 390
 * (`apps/web/e2e/captures.spec.ts`). The Pilote signed in.
 */
export const menuPlus = defineScenario({
  name: 'a-toi-menu-plus',
  path: '/parametres/composants?c=MenuItem',
  seed: signInPilot,
});
