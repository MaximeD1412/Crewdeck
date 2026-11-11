import { zState } from '@crewdeck/contracts';
import { createClient } from '../api/client.js';
import { createConnection } from './connection.js';
import { createStore } from './store.js';

/**
 * The page's store, its socket and its API client (ADR 0008, « Front data »):
 * one of each per page, the Pilote's. Each ticket registers its slices here;
 * pages read the store through their view function and send their commands
 * through `client`, never a fetch of their own.
 */
export const store = createStore();
store.registerSlice('pilot', { shape: 'single' });
store.registerSlice('runner', { shape: 'single' });
store.registerSlice('runner-link', { shape: 'single' });

export const client = createClient({
  seq: () => store.getState().seq,
  onStale: () => connection.catchUp(),
});

export const connection = createConnection({ store, snapshot: () => client.query('/api/state', zState) });
