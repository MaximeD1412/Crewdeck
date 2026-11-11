import { defineScenario } from './define.js';
import { signInPilot } from './sign-in.js';

/**
 * The library of Composants (`design/screens.json`: `composants`), opened on
 * Banner. The Pilote signed in; the page is built from the declarations alone.
 */
export const composants = defineScenario({
  name: 'composants',
  path: '/parametres/composants?c=Banner',
  seed: signInPilot,
});
