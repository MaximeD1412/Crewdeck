import { defineScenario, type Scenario } from './define.js';
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

/** The Composants of a Session (UI-7), each opened in the library, the Pilote signed in: `composants-<tag without cd->`. */
const SESSION_COMPOSANTS = ['Session', 'Message', 'ToolCall', 'Question', 'PermissionRequest', 'Composer'] as const;

const kebab = (name: string) => name.replace(/(?<!^)[A-Z]/g, (c) => `-${c}`).toLowerCase();

export const composantsSession: readonly Scenario[] = SESSION_COMPOSANTS.map((name) =>
  defineScenario({ name: `composants-${kebab(name)}`, path: `/parametres/composants?c=${name}`, seed: signInPilot }),
);

/** The library opened on the form Composants and the Dialog (UI-4), for their visual review, the Pilote signed in. */
export const composantsTextField = defineScenario({
  name: 'composants-textfield',
  path: '/parametres/composants?c=TextField',
  seed: signInPilot,
});

export const composantsSettingRow = defineScenario({
  name: 'composants-settingrow',
  path: '/parametres/composants?c=SettingRow',
  seed: signInPilot,
});

export const composantsDialog = defineScenario({
  name: 'composants-dialog',
  path: '/parametres/composants?c=Dialog',
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

/** The library opened on each Composant of tracks and figures (UI-6), `composants-<name in lower case>`, the Pilote signed in. */
export const composantsFigures = ['ProcessTrack', 'UsageMeter', 'Stat', 'CheckRow', 'Capture', 'TicketTree', 'Timeline'].map(
  (name) =>
    defineScenario({
      name: `composants-${name.toLowerCase()}`,
      path: `/parametres/composants?c=${name}`,
      seed: signInPilot,
    }),
);
