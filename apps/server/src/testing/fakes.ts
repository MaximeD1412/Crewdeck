import { FakeFx } from './fake-fx.js';
import { FakeGitHub } from './fake-github.js';
import { FakeGoogle } from './fake-google.js';
import { FakeMailer } from './fake-mailer.js';
import { FakeRunner } from './fake-runner.js';
import { FakeSmoke } from './fake-smoke.js';
import { FakeWaitingWork } from './fake-waiting-work.js';

/** A fake of an external system (GitHub, Google, the Runner, the mail) that a scenario seeds. */
export interface Fake {
  /** Back to the empty state, before each scenario. */
  reset(): void | Promise<void>;
}

/**
 * The fakes a scenario's `seed` gets as `ctx.fakes`, by name. The tickets that
 * build them add their entry here and in `createFakes`: the fake GitHub
 * (CORE-3), the fake Runner (RUNNER-2), the work waiting for it (ATOI-3), the
 * page's side of the smoke test (RUNNER-14), the fake mail (CORE-9), the
 * fake Google (CORE-10), the fake ECB (RUNNER-13).
 */
export interface Fakes {
  /** Registered with `RunnerWaitingWork` by `ScenariosService`; reset before the Runner, so its disconnection finds none. */
  readonly waitingWork: FakeWaitingWork;
  /** Bound to `GITHUB_CLIENT` and served under `/fake-github`. */
  readonly github: FakeGitHub;
  /** Connected by `ScenariosService` when the scenario links a Runner (`ScenarioSeed.runnerToken`). */
  readonly runner: FakeRunner;
  /** Bound to `FX_SOURCE`: the ECB's daily file. */
  readonly fx: FakeFx;
  /** The link the scenario `smoke` drew, for `/api/testing/smoke/*`. */
  readonly smoke: FakeSmoke;
  /** Bound to `MAILER`: the sign-in links, read back on `GET /api/testing/mails`. */
  readonly mail: FakeMailer;
  /** Bound to `GOOGLE_CLIENT`, its authorize page served at `/fake-google/authorize`. */
  readonly google: FakeGoogle;
}

/** The token of the `Fakes` the testing module shares with the fakes' modules. */
export const FAKES = Symbol('FAKES');

export const createFakes = (): Fakes => ({
  waitingWork: new FakeWaitingWork(),
  github: new FakeGitHub(),
  runner: new FakeRunner(),
  smoke: new FakeSmoke(),
  mail: new FakeMailer(),
  google: new FakeGoogle(),
  fx: new FakeFx(),
});

export const resetFakes = async (fakes: Fakes): Promise<void> => {
  for (const fake of Object.values(fakes) as Fake[]) await fake.reset();
};
