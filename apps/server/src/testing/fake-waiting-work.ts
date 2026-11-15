import type { WaitingProject } from '@crewdeck/contracts';
import type { WaitingWorkProvider } from '../runners/waiting-work.js';
import type { Fake } from './fakes.js';

/**
 * The work that waits for the Runner, as the Boucle, the Idées and the
 * StepRuns will declare it (ATOI-3): a scenario, or the end-to-end test
 * through `POST /api/testing/runner/waiting-work`, says it for its Pilote.
 * `ScenariosService` registers it with `RunnerWaitingWork`.
 */
export class FakeWaitingWork implements Fake, WaitingWorkProvider {
  readonly key = 'testing';
  private readonly projects = new Map<string, readonly WaitingProject[]>();

  /** What waits for `pilotId`'s Runner from now on, in place of what was declared before. */
  declare(pilotId: string, projects: readonly WaitingProject[]): void {
    this.projects.set(pilotId, projects);
  }

  projectsWaiting(pilotId: string): Promise<WaitingProject[]> {
    return Promise.resolve([...(this.projects.get(pilotId) ?? [])]);
  }

  reset(): void {
    this.projects.clear();
  }
}
