import { FakeGitHub } from './fake-github.js';
import { FakeMailer } from './fake-mailer.js';
import { FakeRunner } from './fake-runner.js';

/** A fake of an external system (GitHub, the Runner, the mail) that a scenario seeds. */
export interface Fake {
  /** Back to the empty state, before each scenario. */
  reset(): void | Promise<void>;
}

/**
 * The fakes a scenario's `seed` gets as `ctx.fakes`, by name. The tickets that
 * build them add their entry here and in `createFakes`: the fake GitHub
 * (CORE-3), the fake Runner (RUNNER-2), the fake mail (CORE-9).
 */
export interface Fakes {
  /** Bound to `GITHUB_CLIENT` and served under `/fake-github`. */
  readonly github: FakeGitHub;
  /** Connected by `ScenariosService` when the scenario links a Runner (`ScenarioSeed.runnerToken`). */
  readonly runner: FakeRunner;
  /** Bound to `MAILER`: the sign-in links, read back on `GET /api/testing/mails`. */
  readonly mail: FakeMailer;
}

/** The token of the `Fakes` the testing module shares with the fakes' modules. */
export const FAKES = Symbol('FAKES');

export const createFakes = (): Fakes => ({ github: new FakeGitHub(), runner: new FakeRunner(), mail: new FakeMailer() });

export const resetFakes = async (fakes: Fakes): Promise<void> => {
  for (const fake of Object.values(fakes) as Fake[]) await fake.reset();
};
