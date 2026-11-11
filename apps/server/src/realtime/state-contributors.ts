import type { State, StateKey } from '@crewdeck/contracts';
import type { Registry } from './registry.js';
import type { Tx } from './transactions.js';

/**
 * A slice of `GET /api/state`: its key in `STATE_SLICES` of the contracts
 * (which gives its schema) and how to read it, with the snapshot's
 * transaction, in the scope of `pilotId`.
 */
export interface StateContributor<K extends StateKey = StateKey> {
  readonly key: K;
  snapshot(tx: Tx, pilotId: string): Promise<State[K]>;
}

/** The token of the slices of `GET /api/state`: each module adds its own in `onModuleInit`. */
export const STATE_CONTRIBUTORS = Symbol('STATE_CONTRIBUTORS');

export type StateContributors = Registry<StateContributor>;
