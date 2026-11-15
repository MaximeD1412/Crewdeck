import { Injectable } from '@nestjs/common';
import { runInPilotScope } from '../scope/scope.context.js';

/**
 * A Pilote's writes of Tickets from GitHub, one after the other, their reads
 * of GitHub included: a webhook never lands between the reconciliation's
 * read and its write, to be undone by what it read before.
 */
@Injectable()
export class TicketsQueue {
  private readonly queues = new Map<string, Promise<unknown>>();

  /** Runs `fn` in `pilotId`'s scope, after the Pilote's writes already queued, whether they failed or not. */
  run<T>(pilotId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(pilotId) ?? Promise.resolve();
    const run = previous.then(
      () => runInPilotScope(pilotId, fn),
      () => runInPilotScope(pilotId, fn),
    );
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(pilotId, settled);
    void settled.then(() => {
      if (this.queues.get(pilotId) === settled) this.queues.delete(pilotId);
    });
    return run;
  }
}
