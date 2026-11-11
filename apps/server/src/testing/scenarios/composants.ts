import { defineScenario, type Scenario } from './define.js';

/**
 * The library of Composants (`design/screens.json`: `composants`), opened on
 * Banner. Nothing seeded: the page is built from the declarations alone.
 */
export const composants = defineScenario({
  name: 'composants',
  path: '/parametres/composants?c=Banner',
  seed: () => ({}),
});

/** The Composants of a Session (UI-7), each opened in the library: `composants-<tag without cd->`. */
const SESSION_COMPOSANTS = ['Session', 'Message', 'ToolCall', 'Question', 'PermissionRequest', 'Composer'] as const;

const kebab = (name: string) => name.replace(/(?<!^)[A-Z]/g, (c) => `-${c}`).toLowerCase();

export const composantsSession: readonly Scenario[] = SESSION_COMPOSANTS.map((name) =>
  defineScenario({ name: `composants-${kebab(name)}`, path: `/parametres/composants?c=${name}`, seed: () => ({}) }),
);
