import { blank } from './blank.js';
import {
  composants,
  composantsDialog,
  composantsFigures,
  composantsRows,
  composantsSession,
  composantsSettingRow,
  composantsTextField,
} from './composants.js';
import { connexion, connexionErreur } from './connexion.js';
import { demarrage, demarrageLiaisonEchouee, demarrageRunnerRelie } from './demarrage.js';
import type { Scenario } from './define.js';
import { menuPlus } from './menu-plus.js';
import { resynchronisation } from './resynchronisation.js';

export { defineScenario, type Scenario, type ScenarioContext, type ScenarioSeed } from './define.js';

/** Every scenario, by name: a screen ticket adds its own here. */
const SCENARIOS: readonly Scenario[] = [
  blank,
  composants,
  connexion,
  connexionErreur,
  demarrage,
  demarrageLiaisonEchouee,
  demarrageRunnerRelie,
  menuPlus,
  resynchronisation,
  ...composantsRows,
  composantsTextField,
  composantsSettingRow,
  composantsDialog,
  ...composantsFigures,
  ...composantsSession,
];

const byName = new Map(SCENARIOS.map((scenario) => [scenario.name, scenario]));

export const findScenario = (name: string): Scenario | undefined => byName.get(name);
