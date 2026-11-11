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

/** The library opened on each Composant of tracks and figures (UI-6), `composants-<name in lower case>`. */
export const composantsFigures = ['ProcessTrack', 'UsageMeter', 'Stat', 'CheckRow', 'Capture', 'TicketTree', 'Timeline'].map(
  (name) =>
    defineScenario({
      name: `composants-${name.toLowerCase()}`,
      path: `/parametres/composants?c=${name}`,
      seed: () => ({}),
    }),
);
