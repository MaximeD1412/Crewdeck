import type { Event, LatencyBatch, LatencySample } from '@crewdeck/contracts';
import { call } from '../api/request.js';
import type { Store } from './store.js';

/** Where the page reports what it measured (CORE-8). */
export const LATENCY_PATH = '/api/metrics/latency';
/** The buffer is sent this long after its first sample… */
export const FLUSH_AFTER_MS = 10_000;
/** …or at once when it holds this many. */
export const FLUSH_AT_SAMPLES = 50;

export interface LatencyMeterOptions {
  readonly store: Store;
  /** `POST /api/metrics/latency` by default. */
  readonly send?: (batch: LatencyBatch) => Promise<unknown>;
  /** `navigator.sendBeacon` by default, the batch as a string (`text/plain`); `false` when the browser refused it. */
  readonly beacon?: (batch: LatencyBatch) => boolean;
  /** The tab's visibility: `document.visibilityState` by default. */
  readonly visibility?: () => DocumentVisibilityState;
}

export interface LatencyMeter {
  start(): void;
  stop(): void;
}

/**
 * The latency of US-20, measured where it ends (ADR 0007): each live event
 * whose source said when it saw the change (`sourceAt`, `source`) gives a
 * sample of `Date.now() - sourceAt`, the browser's clock against the
 * server's. Nothing while the tab is hidden nor during a replay: the delay
 * would measure the Pilote's absence. The samples are sent by batch, 10 s
 * after the first one or at 50; what is left goes through `sendBeacon` when
 * the page hides (`pagehide`, or the tab hidden). A batch that fails is
 * dropped: a measure, not a state to keep.
 */
export const createLatencyMeter = ({
  store,
  send = (batch) => call('POST', LATENCY_PATH, batch),
  beacon = (batch) => navigator.sendBeacon(LATENCY_PATH, JSON.stringify(batch)),
  visibility = () => document.visibilityState,
}: LatencyMeterOptions): LatencyMeter => {
  let buffer: LatencySample[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const take = (): LatencyBatch | null => {
    clearTimeout(timer);
    timer = undefined;
    if (buffer.length === 0) return null;
    const batch = { samples: buffer };
    buffer = [];
    return batch;
  };

  const flush = () => {
    const batch = take();
    if (batch) send(batch).catch(() => undefined);
  };

  const flushByBeacon = () => {
    const batch = take();
    if (batch) beacon(batch);
  };

  const onEvent = (event: Event, live: boolean) => {
    if (!live || !event.sourceAt || !event.source || visibility() !== 'visible') return;
    const now = Date.now();
    const delayMs = Math.round(now - Date.parse(event.sourceAt));
    // The browser's clock behind the server's: no delay to tell.
    if (delayMs < 0) return;
    buffer.push({ seq: event.seq, source: event.source, delayMs, at: new Date(now).toISOString() });
    if (buffer.length >= FLUSH_AT_SAMPLES) flush();
    else timer ??= setTimeout(flush, FLUSH_AFTER_MS);
  };

  const onVisibilityChange = () => {
    if (visibility() === 'hidden') flushByBeacon();
  };

  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = store.onEvent(onEvent);
      window.addEventListener('pagehide', flushByBeacon);
      document.addEventListener('visibilitychange', onVisibilityChange);
    },
    stop() {
      unsubscribe?.();
      unsubscribe = undefined;
      window.removeEventListener('pagehide', flushByBeacon);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimeout(timer);
      timer = undefined;
      buffer = [];
    },
  };
};
