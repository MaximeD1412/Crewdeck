import type { EngineEvent, SessionRelayError } from '@crewdeck/contracts';
import type { SessionRelay } from './relay.js';

/** One event of a Session as « À toi » reads it: on its way, read, or not to be read. */
export type SessionEventRead =
  | { readonly state: 'reading' }
  | { readonly state: 'read'; readonly event: EngineEvent }
  | { readonly state: 'unavailable'; readonly reason: SessionRelayError | 'timeout' };

export interface SessionPeek {
  /** The event `seq` of the Session: read once, through the relay, then kept in memory. */
  read(sessionId: string, seq: number): SessionEventRead;
  /** Called after each read that comes, or fails, never during `read`. */
  subscribe(listener: () => void): () => void;
}

export interface SessionPeekOptions {
  readonly relay: Pick<SessionRelay, 'openSession' | 'closeSession'>;
  /** How long a read waits for its event; 15 s by default. */
  readonly timeoutMs?: number;
}

/**
 * A look at one event of a Session (SESSION-3): « À toi » shows the text of a
 * question or the command of a permission request, which only the Runner
 * holds (ADR 0003). The peek opens the Session from the event's `seq`, keeps
 * that event and closes it; a refusal of the relay or no event in time makes
 * it unavailable. What it read stays in this tab's memory, never stored.
 */
export const createSessionPeek = ({ relay, timeoutMs = 15_000 }: SessionPeekOptions): SessionPeek => {
  const reads = new Map<string, SessionEventRead>();
  const listeners = new Set<() => void>();

  const start = (key: string, sessionId: string, seq: number) => {
    const subscription = relay.openSession(sessionId, seq);
    let done = false;
    const finish = (read: SessionEventRead) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      reads.set(key, read);
      relay.closeSession(sessionId);
      // Later: a read may come while the page computes its data, which a subscriber recomputes.
      queueMicrotask(() => {
        for (const listener of listeners) listener();
      });
    };
    const look = () => {
      const event = subscription.events().find((candidate) => candidate.seq === seq);
      if (event) return finish({ state: 'read', event });
      const error = subscription.error();
      if (error) finish({ state: 'unavailable', reason: error });
    };
    const stop = subscription.onChange(look);
    const timer = setTimeout(() => finish({ state: 'unavailable', reason: 'timeout' }), timeoutMs);
    look();
  };

  return {
    read(sessionId, seq) {
      const key = `${sessionId}:${seq}`;
      const known = reads.get(key);
      if (known) return known;
      reads.set(key, { state: 'reading' });
      start(key, sessionId, seq);
      return reads.get(key) as SessionEventRead;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
