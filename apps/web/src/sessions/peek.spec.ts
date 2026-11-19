import type { EngineEvent, SessionRelayError } from '@crewdeck/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionPeek } from './peek.js';
import type { SessionSubscription } from './relay.js';

const SESSION = '019a6f1e-7c3d-7e4f-9a1b-5e5510000001';
const AT = '2026-11-19T09:00:00.000Z';
const question: EngineEvent = {
  seq: 4,
  at: AT,
  kind: 'question',
  requestId: 'toolu_01',
  title: 'Quelles règles pour l’agenda ?',
  options: [{ label: 'Une semaine' }],
  multiple: false,
} as EngineEvent;

/** A relay whose Session the test feeds: its events and errors, and the opens and closes it was asked. */
const fakeRelay = () => {
  let events: EngineEvent[] = [];
  let error: SessionRelayError | null = null;
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  const subscription: SessionSubscription = {
    sessionId: SESSION,
    events: () => events,
    error: () => error,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    calls,
    listeners,
    relay: {
      openSession: (sessionId: string, fromSeq?: number) => {
        calls.push(`open ${sessionId} ${fromSeq}`);
        return subscription;
      },
      closeSession: (sessionId: string) => void calls.push(`close ${sessionId}`),
    },
    emit(next: EngineEvent[], nextError: SessionRelayError | null = null) {
      events = next;
      error = nextError;
      for (const listener of [...listeners]) listener();
    },
  };
};

afterEach(() => vi.useRealTimers());

describe('createSessionPeek', () => {
  it('opens the Session from the event, keeps it, closes, and tells its subscribers', async () => {
    const fake = fakeRelay();
    const peek = createSessionPeek({ relay: fake.relay });
    const changed = vi.fn();
    peek.subscribe(changed);

    expect(peek.read(SESSION, 4)).toEqual({ state: 'reading' });
    expect(fake.calls).toEqual([`open ${SESSION} 4`]);
    fake.emit([question]);

    expect(peek.read(SESSION, 4)).toEqual({ state: 'read', event: question });
    expect(fake.calls).toEqual([`open ${SESSION} 4`, `close ${SESSION}`]);
    expect(fake.listeners.size).toBe(0);
    expect(changed).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('reads an event the tab already holds at once, and opens the Session once per event', () => {
    const fake = fakeRelay();
    fake.emit([question]);
    const peek = createSessionPeek({ relay: fake.relay });
    expect(peek.read(SESSION, 4)).toEqual({ state: 'read', event: question });
    peek.read(SESSION, 4);
    expect(fake.calls).toEqual([`open ${SESSION} 4`, `close ${SESSION}`]);
  });

  it('is unavailable on a refusal of the relay, or when no event comes in time; it closes either way', () => {
    vi.useFakeTimers();
    const fake = fakeRelay();
    const peek = createSessionPeek({ relay: fake.relay, timeoutMs: 1000 });
    peek.read(SESSION, 4);
    fake.emit([], 'session.runner-offline');
    expect(peek.read(SESSION, 4)).toEqual({ state: 'unavailable', reason: 'session.runner-offline' });

    const late = fakeRelay();
    const slow = createSessionPeek({ relay: late.relay, timeoutMs: 1000 });
    slow.read(SESSION, 6);
    vi.advanceTimersByTime(1000);
    expect(slow.read(SESSION, 6)).toEqual({ state: 'unavailable', reason: 'timeout' });
    expect(late.calls).toEqual([`open ${SESSION} 6`, `close ${SESSION}`]);
  });

  it('a read unavailable, the Runner back: `retry` opens the Session again, and the event is read', () => {
    const fake = fakeRelay();
    const peek = createSessionPeek({ relay: fake.relay });
    peek.read(SESSION, 4);
    fake.emit([], 'session.runner-offline');
    expect(peek.read(SESSION, 4)).toEqual({ state: 'unavailable', reason: 'session.runner-offline' });

    peek.retry();
    fake.emit([]);
    expect(peek.read(SESSION, 4)).toEqual({ state: 'reading' });
    fake.emit([question]);
    expect(peek.read(SESSION, 4)).toEqual({ state: 'read', event: question });
    expect(fake.calls).toEqual([`open ${SESSION} 4`, `close ${SESSION}`, `open ${SESSION} 4`, `close ${SESSION}`]);
  });

  it('a read that timed out is tried again once `retryMs` passed, its subscribers told; a read that came is never read again', async () => {
    vi.useFakeTimers();
    const fake = fakeRelay();
    const peek = createSessionPeek({ relay: fake.relay, timeoutMs: 1000, retryMs: 5000 });
    const changed = vi.fn();
    peek.subscribe(changed);
    peek.read(SESSION, 4);
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4999);
    expect(peek.read(SESSION, 4)).toEqual({ state: 'unavailable', reason: 'timeout' });
    vi.advanceTimersByTime(1);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(peek.read(SESSION, 4)).toEqual({ state: 'reading' });
    fake.emit([question]);
    expect(peek.read(SESSION, 4)).toEqual({ state: 'read', event: question });
    peek.retry();
    vi.advanceTimersByTime(60_000);
    expect(peek.read(SESSION, 4)).toEqual({ state: 'read', event: question });
    expect(fake.calls.filter((call) => call.startsWith('open'))).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
