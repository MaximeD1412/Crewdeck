import { defineScenario } from './define.js';

/**
 * The library of Composants (`design/screens.json`: `composants`), opened on
 * Banner. Nothing seeded: the page is built from the declarations alone.
 */
export const composants = defineScenario({
  name: 'composants',
  path: '/parametres/composants?c=Banner',
  seed: () => ({}),
});
