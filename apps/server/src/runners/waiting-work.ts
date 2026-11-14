import type { WaitingProject } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export type { WaitingItem, WaitingProject } from '@crewdeck/contracts';

/**
 * A module that has work for the Runner (the Boucle, the Idées' analysis,
 * the queued StepRuns): the Projets whose work waits for `pilotId`'s Runner,
 * from readable state only (ids, numbers, counts). Called in the Pilote's
 * scope.
 */
export interface WaitingWorkProvider {
  /** Its module, once per provider: `loops`, `ideas`, `step-runs`. */
  readonly key: string;
  projectsWaiting(pilotId: string): Promise<WaitingProject[]>;
}

/** « Idées » last: the Idées not yet in a Projet are not one. */
const byName = (a: WaitingProject, b: WaitingProject): number =>
  Number(a.projectId === null) - Number(b.projectId === null) || a.name.localeCompare(b.name, 'fr');

/**
 * The registry of the work that waits for the Runner (ATOI-3): each module
 * that has some registers its provider at its boot; « Runner hors ligne »
 * (`RunnerOffline`) collects them when the Runner goes offline, and again
 * when a module calls `RunnerOffline.refresh`.
 */
@Injectable()
export class RunnerWaitingWork {
  private readonly providers = new Map<string, WaitingWorkProvider>();

  constructor(@InjectPinoLogger(RunnerWaitingWork.name) private readonly logger: PinoLogger) {}

  /** Adds `provider`; returns its removal. One per key. */
  register(provider: WaitingWorkProvider): () => void {
    if (this.providers.has(provider.key)) throw new Error(`A waiting work provider ${provider.key} is already registered`);
    this.providers.set(provider.key, provider);
    return () => {
      if (this.providers.get(provider.key) === provider) this.providers.delete(provider.key);
    };
  }

  /**
   * Every provider's Projets for `pilotId`, merged by Projet (their items one
   * after the other, in the providers' order), those with no item left out,
   * by name. A provider that fails is logged and left out: the others' work
   * still shows.
   */
  async collect(pilotId: string): Promise<WaitingProject[]> {
    const providers = [...this.providers.values()];
    const results = await Promise.allSettled(providers.map((provider) => provider.projectsWaiting(pilotId)));
    const merged = new Map<string | null, WaitingProject>();
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error({ err: result.reason, provider: providers[index]?.key }, 'waiting work provider failed');
        return;
      }
      for (const project of result.value) {
        if (project.items.length === 0) continue;
        const known = merged.get(project.projectId);
        merged.set(project.projectId, known ? { ...known, items: [...known.items, ...project.items] } : { ...project, items: [...project.items] });
      }
    });
    return [...merged.values()].sort(byName);
  }
}
