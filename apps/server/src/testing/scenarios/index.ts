import { blank } from './blank.js';
import { composants, composantsDialog, composantsSettingRow, composantsTextField } from './composants.js';
import type { Scenario } from './define.js';

export { defineScenario, type Scenario, type ScenarioContext, type ScenarioSeed } from './define.js';

/** Every scenario, by name: a screen ticket adds its own here. */
const SCENARIOS: readonly Scenario[] = [blank, composants, composantsTextField, composantsSettingRow, composantsDialog];

const byName = new Map(SCENARIOS.map((scenario) => [scenario.name, scenario]));

export const findScenario = (name: string): Scenario | undefined => byName.get(name);
