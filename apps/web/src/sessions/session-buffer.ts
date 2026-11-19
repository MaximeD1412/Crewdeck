import type { EngineEvent } from '@crewdeck/contracts';

/** What adding an event did: kept, already held (dropped), or kept after a hole. */
export type BufferAdd = 'added' | 'duplicate' | 'gap';

/**
 * The decrypted events of one Session (SESSION-1), or the chunks of a
 * Commande's run (RUNNER-18), ordered by `seq`, in memory only: never
 * IndexedDB, localStorage nor the store, dropped with the subscription. It
 * starts at the `seq` the tab opened from; an event past a hole is kept, and
 * shown once the hole is filled.
 */
export interface SessionBuffer<T extends { readonly seq: number } = EngineEvent> {
  add(event: T): BufferAdd;
  /** The events from the first `seq` up to the first hole, in order. */
  events(): readonly T[];
  /** The first `seq` the buffer lacks: where a replay starts. */
  missing(): number;
  clear(): void;
}

export const createSessionBuffer = <T extends { readonly seq: number } = EngineEvent>(fromSeq = 1): SessionBuffer<T> => {
  const held = new Map<number, T>();
  let shown: T[] = [];
  let next = fromSeq;

  return {
    add(event) {
      if (event.seq < fromSeq || held.has(event.seq)) return 'duplicate';
      held.set(event.seq, event);
      if (event.seq !== next) return 'gap';
      const before = shown.length;
      while (held.has(next)) next += 1;
      shown = [...shown, ...Array.from({ length: next - fromSeq - before }, (_, i) => held.get(fromSeq + before + i) as T)];
      return 'added';
    },
    events: () => shown,
    missing: () => next,
    clear() {
      held.clear();
      shown = [];
      next = fromSeq;
    },
  };
};
