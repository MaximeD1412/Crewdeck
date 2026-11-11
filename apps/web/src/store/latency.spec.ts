import { type Event, type LatencyBatch, type Me, zLatencyBatch } from '@crewdeck/contracts';
import { createLatencyMeter, FLUSH_AFTER_MS, FLUSH_AT_SAMPLES, type LatencyMeter } from './latency.js';
import { createStore, type Store } from './store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris' };
const NOW = Date.parse('2026-11-11T08:00:00.000Z');

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

const pilotEvent = (seq: number, extra: Partial<Event> = {}): Event => ({ seq, type: 'pilot.upserted', payload: PILOT, at: ago(0), ...extra });
const measured = (seq: number, delayMs = 300): Event => pilotEvent(seq, { sourceAt: ago(delayMs), source: 'github' });

describe('the latency meter', () => {
  let store: Store;
  let meter: LatencyMeter;
  let sent: LatencyBatch[];
  let beacons: LatencyBatch[];
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    store = createStore();
    store.registerSlice('pilot', { shape: 'single' });
    store.applySnapshot({ seq: 0, pilot: PILOT, runner: null });
    sent = [];
    beacons = [];
    visibility = 'visible';
    meter = createLatencyMeter({
      store,
      send: async (batch) => {
        sent.push(zLatencyBatch.parse(batch));
      },
      beacon: (batch) => {
        beacons.push(zLatencyBatch.parse(batch));
        return true;
      },
      visibility: () => visibility,
    });
    meter.start();
  });

  afterEach(() => {
    meter.stop();
    vi.useRealTimers();
  });

  /** Applies `count` live events from `from`, each measured `delayMs` after its source. */
  const live = (count: number, from = 1, delayMs = 300): void => {
    store.markLive();
    for (let seq = from; seq < from + count; seq++) store.applyEvent(measured(seq, delayMs));
  };

  const flushed = (): LatencyBatch['samples'] => [...sent, ...beacons].flatMap((batch) => batch.samples);

  describe('what it measures', () => {
    it('turns a live event whose source saw the change 300 ms ago into a sample of 300 ms', async () => {
      live(1);
      await vi.advanceTimersByTimeAsync(FLUSH_AFTER_MS);

      expect(flushed()).toEqual([{ seq: 1, source: 'github', delayMs: 300, at: new Date(NOW).toISOString() }]);
    });

    it('measures nothing during a replay: before live, and during a catch-up', async () => {
      store.applyEvent(measured(1));
      store.markLive();
      store.markStale();
      store.applyEvent(measured(2));
      await vi.advanceTimersByTimeAsync(FLUSH_AFTER_MS);

      expect(store.getState().seq).toBe(2n);
      expect(flushed()).toEqual([]);
    });

    it('measures nothing while the tab is hidden', async () => {
      visibility = 'hidden';
      live(1);
      await vi.advanceTimersByTimeAsync(FLUSH_AFTER_MS);

      expect(store.getState().seq).toBe(1n);
      expect(flushed()).toEqual([]);
    });

    it('measures nothing for an event without sourceAt or source, ignored, or ahead of the clock', async () => {
      store.markLive();
      store.applyEvent(pilotEvent(1));
      store.applyEvent(pilotEvent(2, { sourceAt: ago(300) }));
      store.applyEvent(measured(2));
      store.applyEvent(measured(3, -50));
      await vi.advanceTimersByTimeAsync(FLUSH_AFTER_MS);

      expect(flushed()).toEqual([]);
    });
  });

  describe('when it sends', () => {
    it('sends the buffer 10 s after its first sample, not before', async () => {
      live(2);
      await vi.advanceTimersByTimeAsync(FLUSH_AFTER_MS - 1);
      expect(sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(sent.map((batch) => batch.samples.length)).toEqual([2]);

      await vi.advanceTimersByTimeAsync(FLUSH_AFTER_MS * 3);
      expect(sent).toHaveLength(1);
    });

    it('sends at once at 50 samples', async () => {
      live(FLUSH_AT_SAMPLES - 1);
      await Promise.resolve();
      expect(sent).toEqual([]);

      live(1, FLUSH_AT_SAMPLES);
      expect(sent.map((batch) => batch.samples.length)).toEqual([FLUSH_AT_SAMPLES]);
      expect(sent[0]?.samples.map((sample) => sample.seq)).toEqual(Array.from({ length: FLUSH_AT_SAMPLES }, (_, i) => i + 1));
    });

    it('sends what is left through sendBeacon on pagehide, and nothing more', async () => {
      live(3);
      window.dispatchEvent(new Event('pagehide'));

      expect(beacons.map((batch) => batch.samples.length)).toEqual([3]);
      await vi.advanceTimersByTimeAsync(FLUSH_AFTER_MS);
      expect(sent).toEqual([]);
    });

    it('sends what is left through sendBeacon when the tab hides', () => {
      live(2);
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));

      expect(beacons.map((batch) => batch.samples.length)).toEqual([2]);
    });

    it('sends nothing on pagehide with an empty buffer', () => {
      window.dispatchEvent(new Event('pagehide'));

      expect(beacons).toEqual([]);
    });

    it('drops a batch the server refused, without an unhandled rejection', async () => {
      const failing = createLatencyMeter({ store, send: () => Promise.reject(new Error('500')), beacon: () => true, visibility: () => 'visible' });
      meter.stop();
      failing.start();
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        live(FLUSH_AT_SAMPLES);
        await vi.advanceTimersByTimeAsync(FLUSH_AFTER_MS);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
        failing.stop();
      }
    });

    it('stops measuring and listening once stopped', async () => {
      meter.stop();
      live(1);
      window.dispatchEvent(new Event('pagehide'));
      await vi.advanceTimersByTimeAsync(FLUSH_AFTER_MS);

      expect(flushed()).toEqual([]);
    });
  });
});
