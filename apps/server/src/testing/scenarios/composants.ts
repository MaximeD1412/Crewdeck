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

/** The library opened on each row Composant (UI-5), `composants-<name in lower case>`, the Pilote signed in. */
export const composantsRows = ['DecisionRow', 'IdeaRow', 'TicketRow', 'AgentRow'].map((name) =>
  defineScenario({
    name: `composants-${name.toLowerCase()}`,
    path: `/parametres/composants?c=${name}`,
    seed: signInPilot,
  }),
);
