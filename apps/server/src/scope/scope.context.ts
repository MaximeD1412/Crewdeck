import { AsyncLocalStorage } from 'node:async_hooks';

/** The scope of one Pilote (ADR 0008): every query of a scoped model runs inside one. */
export interface PilotScope {
  readonly pilotId: string;
}

const storage = new AsyncLocalStorage<PilotScope>();

/**
 * A scoped model touched outside any scope: a bug (a 500), never the client's
 * fault. A request gets its scope from `ScopeGuard`; a webhook or a scheduler
 * job opens the one of the Pilote it concerns with `runInPilotScope`.
 */
export class ScopeMissingError extends Error {
  constructor() {
    super('A scoped model was queried outside any Pilote scope: wrap the call in runInPilotScope.');
    this.name = 'ScopeMissingError';
  }
}

/**
 * Runs `fn` in the scope of `pilotId`, for a webhook or a scheduler job, and
 * awaits its result inside the scope: a deferred query `fn` returns (a
 * PrismaPromise only runs once awaited) runs in the scope too.
 */
export const runInPilotScope = <T>(pilotId: string, fn: () => T | PromiseLike<T>): Promise<T> =>
  storage.run({ pilotId }, async () => await fn());

/**
 * Calls `fn` synchronously in the scope of `pilotId` and returns what it
 * returns, as is: for `ScopeInterceptor`, which subscribes to the handler's
 * Observable inside the scope. Elsewhere, `runInPilotScope`.
 */
export const withPilotScope = <T>(pilotId: string, fn: () => T): T => storage.run({ pilotId }, fn);

/** The Pilote of the current scope; throws `ScopeMissingError` outside one. */
export const currentPilotId = (): string => {
  const scope = storage.getStore();
  if (!scope) throw new ScopeMissingError();
  return scope.pilotId;
};
