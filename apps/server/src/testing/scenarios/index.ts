import { blank } from './blank.js';
import {
  composants,
  composantsDialog,
  composantsFigures,
  composantsRows,
  composantsSession,
  composantsSettingRow,
  composantsTextField,
  confirmDialog,
} from './composants.js';
import { connexion, connexionErreur } from './connexion.js';
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
  menuPlus,
  resynchronisation,
  ...composantsRows,
  composantsTextField,
  composantsSettingRow,
  composantsDialog,
  confirmDialog,
  ...composantsFigures,
  ...composantsSession,
];

const byName = new Map(SCENARIOS.map((scenario) => [scenario.name, scenario]));

export const findScenario = (name: string): Scenario | undefined => byName.get(name);
