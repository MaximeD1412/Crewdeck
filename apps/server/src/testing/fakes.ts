import { FakeGitHub } from './fake-github.js';
import { FakeRunner } from './fake-runner.js';
import { FakeWaitingWork } from './fake-waiting-work.js';

/** A fake of an external system (GitHub, the Runner) that a scenario seeds. */
export interface Fake {
  /** Back to the empty state, before each scenario. */
  reset(): void | Promise<void>;
}

/**
 * The fakes a scenario's `seed` gets as `ctx.fakes`, by name. The tickets that
 * build them add their entry here and in `createFakes`: the fake GitHub
 * (CORE-3), the fake Runner (RUNNER-2), the work waiting for it (ATOI-3).
 */
export interface Fakes {
  /** Registered with `RunnerWaitingWork` by `ScenariosService`; reset before the Runner, so its disconnection finds none. */
  readonly waitingWork: FakeWaitingWork;
  /** Bound to `GITHUB_CLIENT` and served under `/fake-github`. */
  readonly github: FakeGitHub;
  /** Connected by `ScenariosService` when the scenario links a Runner (`ScenarioSeed.runnerToken`). */
  readonly runner: FakeRunner;
}

/** The token of the `Fakes` the testing module shares with the fakes' modules. */
export const FAKES = Symbol('FAKES');

export const createFakes = (): Fakes => ({ waitingWork: new FakeWaitingWork(), github: new FakeGitHub(), runner: new FakeRunner() });

export const resetFakes = async (fakes: Fakes): Promise<void> => {
  for (const fake of Object.values(fakes) as Fake[]) await fake.reset();
};
