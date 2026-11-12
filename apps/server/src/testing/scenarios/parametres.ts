import { defineScenario } from './define.js';
import { signInPilot } from './sign-in.js';

/**
 * The Paramètres of the account (`design/screens.json`: `parametres`), the
 * Pilote signed in with the settings by default: « Compte » (the time zone)
 * and « Pour les Moddeurs », the other sections their tickets'.
 */
export const parametres = defineScenario({
  name: 'parametres',
  path: '/parametres',
  seed: signInPilot,
});
