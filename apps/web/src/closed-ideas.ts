import type { Idea } from '@crewdeck/contracts';
import type { Client } from './api/client.js';
import { listClosedIdeas } from './api/ideas.js';

/** What « Idées » shows of the Idées merged or rejected read from `GET /api/ideas`, beside the `idea` slice. */
export interface ClosedIdeasView {
  /** The Idées read so far, the last updated first. */
  readonly ideas: readonly Idea[];
  /** Whether the first page came: until then, a page without an Idée in the slice may still have some. */
  readonly known: boolean;
  /** PageIdees' `older`: `available` while a page remains or the last read failed, `loading` while one comes. */
  readonly older: 'none' | 'available' | 'loading';
}

export interface ClosedIdeas {
  /** Reads the first page, once; « Idées » calls it as it shows. */
  ensure(): void;
  /** Reads the next page (« Afficher les plus anciennes »), or the first one again after a failure; a refusal is thrown, for the page to show. */
  more(): Promise<void>;
  view(): ClosedIdeasView;
  /** Calls `fn` after each change; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

/**
 * The Idées merged or rejected beyond the `idea` slice (IDEE-1): the
 * snapshot holds only those updated in the last 90 days, the older ones come
 * from `GET /api/ideas?states=merged,rejected`, 50 a page. A page read once
 * stays: an Idée changed since comes through the slice, which wins.
 */
export const createClosedIdeas = ({ client }: { readonly client: Pick<Client, 'query'> }): ClosedIdeas => {
  const listeners = new Set<() => void>();
  const ideas = new Map<string, Idea>();
  /** `undefined` before the first page, `null` once the last one came. */
  let cursor: string | null | undefined;
  let loading = false;
  let failed = false;
  let started = false;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  /** `announce`: whether to say at once that a page comes; not during a render, which already shows it coming. */
  const read = async (announce: boolean) => {
    if (loading || cursor === null) return;
    loading = true;
    failed = false;
    if (announce) notify();
    try {
      const page = await listClosedIdeas(client, cursor);
      for (const idea of page.items) ideas.set(idea.id, idea);
      cursor = page.nextCursor;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      loading = false;
      notify();
    }
  };

  return {
    ensure() {
      if (started) return;
      started = true;
      // A first page not read leaves « Afficher les plus anciennes » to read it again.
      read(false).catch(() => undefined);
    },
    more() {
      started = true;
      return read(true);
    },
    view() {
      return {
        ideas: [...ideas.values()],
        known: cursor !== undefined,
        older: loading ? 'loading' : failed || typeof cursor === 'string' ? 'available' : 'none',
      };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
