import type { Event, Me, Resource, Runner, RunnerLink, State } from '@crewdeck/contracts';

/**
 * Where the page stands with the server (ADR 0007): `connecting` at boot,
 * before its first snapshot or replay; `resync` once the socket was lost, a
 * `seq` skipped or a command answered stale, until the snapshot or the replay is applied; `live` after.
 */
export type Connection = 'connecting' | 'resync' | 'live';

/**
 * The slices the page holds, by resource: each ticket registers its own
 * (`registerSlice`) and adds it here. A `single` is the resource or `null`,
 * a `collection` a map of the resources by id.
 */
export interface Slices {
  readonly pilot: Me | null;
  /** The Pilote's Runner, `null` while none is linked (RUNNER-3). */
  readonly runner: Runner | null;
  /** The Pilote's last link code, `null` before any: « Premiers pas » follows it (RUNNER-3). */
  readonly 'runner-link': RunnerLink | null;
}

export interface StoreState {
  /** The `seq` of the last event applied, or of the snapshot; `null` before any. */
  readonly seq: bigint | null;
  readonly connection: Connection;
  /** When the page lost the state for sure, the first loss since it was last `live`. */
  readonly lostAt: Date | null;
  /** The registered slices, once a snapshot gave them. */
  readonly slices: Partial<Slices>;
}

export type SliceShape = 'collection' | 'single';

/** What `applyEvent` did: `gap` when a `seq` was skipped, the store then in `resync`. */
export type EventOutcome = 'applied' | 'ignored' | 'gap';

export interface Store {
  getState(): StoreState;
  /** Calls `fn` after each change; returns the function that stops. */
  subscribe(fn: (state: StoreState) => void): () => void;
  /** Declares the slice of `resource`, fed by the snapshot's key of the same name and by its events. */
  registerSlice(resource: Resource, options: { shape: SliceShape }): void;
  /** Replaces every registered slice and the `seq` with `GET /api/state`'s. */
  applySnapshot(state: State): void;
  /** Applies the event that follows the `seq`; ignores one already applied; a later one is a gap. */
  applyEvent(event: Event): EventOutcome;
  /** The replay or the snapshot is applied: what follows is live. */
  markLive(): void;
  /** The socket is lost: `resync`, `lostAt` kept from the first loss. */
  markLost(at: Date): void;
  /** The state is known to be behind (a 409 `realtime.stale`), the socket kept: `resync` until live, no loss time added. */
  markStale(): void;
}

type Identified = { readonly id: string };

/**
 * The page's store (ADR 0008, « Front data »): the state of the Process the
 * page shows, fed only by the snapshot and the events, read by the views.
 * Each change gives a new state; a slice that did not change keeps its value.
 */
export const createStore = (): Store => {
  const shapes = new Map<string, SliceShape>();
  const listeners = new Set<(state: StoreState) => void>();
  let state: StoreState = { seq: null, connection: 'connecting', lostAt: null, slices: {} };

  const set = (next: StoreState) => {
    state = next;
    for (const listener of [...listeners]) listener(state);
  };

  const slices = (): Record<string, unknown> => ({ ...state.slices });

  const applyChange = (event: Event): Partial<Slices> => {
    const [resource, verb] = event.type.split('.') as [string, 'upserted' | 'removed'];
    const shape = shapes.get(resource);
    if (!shape) return state.slices;
    const next = slices();
    if (shape === 'single') {
      next[resource] = verb === 'upserted' ? event.payload : null;
    } else {
      const map = new Map(next[resource] as ReadonlyMap<string, unknown> | undefined);
      const { id } = event.payload as Identified;
      if (verb === 'upserted') map.set(id, event.payload);
      else map.delete(id);
      next[resource] = map;
    }
    return next as Partial<Slices>;
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    registerSlice(resource, { shape }) {
      if (shapes.has(resource)) throw new Error(`La tranche ${resource} est déjà enregistrée`);
      shapes.set(resource, shape);
    },
    applySnapshot(snapshot) {
      const next = slices();
      const values = snapshot as unknown as Readonly<Record<string, unknown>>;
      for (const [resource, shape] of shapes) {
        const value = values[resource];
        next[resource] = shape === 'single' ? (value ?? null) : new Map((value as readonly Identified[]).map((item) => [item.id, item]));
      }
      set({ ...state, seq: BigInt(snapshot.seq), slices: next as Partial<Slices> });
    },
    applyEvent(event) {
      const seq = BigInt(event.seq);
      if (state.seq === null || seq <= state.seq) return 'ignored';
      if (seq > state.seq + 1n) {
        set({ ...state, connection: 'resync', lostAt: state.lostAt ?? new Date() });
        return 'gap';
      }
      set({ ...state, seq, slices: applyChange(event) });
      return 'applied';
    },
    markLive() {
      set({ ...state, connection: 'live', lostAt: null });
    },
    markLost(at) {
      set({ ...state, connection: 'resync', lostAt: state.lostAt ?? at });
    },
    markStale() {
      set({ ...state, connection: 'resync' });
    },
  };
};
