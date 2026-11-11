import { blank } from './blank.js';
import { composants, composantsFigures, composantsRows } from './composants.js';
import { connexion, connexionErreur } from './connexion.js';
import type { Scenario } from './define.js';
import { menuPlus } from './menu-plus.js';

export { defineScenario, type Scenario, type ScenarioContext, type ScenarioSeed } from './define.js';

/** Every scenario, by name: a screen ticket adds its own here. */
const SCENARIOS: readonly Scenario[] = [blank, composants, connexion, connexionErreur, menuPlus, ...composantsRows, ...composantsFigures];

const byName = new Map(SCENARIOS.map((scenario) => [scenario.name, scenario]));

export const findScenario = (name: string): Scenario | undefined => byName.get(name);
