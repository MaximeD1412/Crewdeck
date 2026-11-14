import { aToi, aToiVide } from './a-toi.js';
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
import { demarrage, demarrageComptesIa, demarrageComptesIaAucun, demarrageLiaisonEchouee, demarrageRunnerRelie } from './demarrage.js';
import type { Scenario } from './define.js';
import { menuPlus } from './menu-plus.js';
import { resynchronisation } from './resynchronisation.js';
import { runner } from './runner.js';
import { aToiRunnerHorsLigne, runnerHorsLigne } from './runner-offline.js';

export { defineScenario, type Scenario, type ScenarioContext, type ScenarioSeed } from './define.js';

/** Every scenario, by name: a screen ticket adds its own here. */
const SCENARIOS: readonly Scenario[] = [
  aToi,
  aToiVide,
  aToiRunnerHorsLigne,
  blank,
  composants,
  connexion,
  connexionErreur,
  demarrage,
  demarrageLiaisonEchouee,
  demarrageRunnerRelie,
  demarrageComptesIa,
  demarrageComptesIaAucun,
  menuPlus,
  resynchronisation,
  runner,
  runnerHorsLigne,
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
