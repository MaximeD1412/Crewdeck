import { defineScenario } from './define.js';

/** Nothing seeded, nobody signed in: the page at `/`. */
export const blank = defineScenario({
  name: 'blank',
  path: '/',
  seed: () => ({}),
});
