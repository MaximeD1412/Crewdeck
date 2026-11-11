import type { PrismaService } from '../../prisma/prisma.service.js';
import type { Fakes } from '../fakes.js';

/** What a scenario's `seed` gets: the database, already emptied, and the fakes, already reset. */
export interface ScenarioContext {
  readonly prisma: PrismaService;
  readonly fakes: Fakes;
}

export interface ScenarioSeed {
  /** The session cookie, `<name>=<value>`, of the Pilote the scenario signs in (CORE-4). */
  readonly sessionCookie?: string;
  /** The token of the Runner the scenario links (`createLinkedRunner`): the fake Runner connects with it, and stays « en ligne ». */
  readonly runnerToken?: string;
}

/**
 * A state of the product an end-to-end test or a capture starts from. Its
 * name is the id of the screen or state it shows in `design/screens.json`
 * (`a-toi`, `a-toi-vide`), its path the page that shows it.
 */
export interface Scenario {
  readonly name: string;
  readonly path: string;
  readonly seed: (ctx: ScenarioContext) => ScenarioSeed | Promise<ScenarioSeed>;
}

export const defineScenario = (scenario: Scenario): Scenario => scenario;
