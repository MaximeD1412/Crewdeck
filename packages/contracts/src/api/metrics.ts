import { z } from 'zod';
import { zEventSource } from '../events/index.js';
import { zInstant, zSeq } from '../values.js';

/** The most samples one `POST /api/metrics/latency` carries; the page sends them by 50. */
export const LATENCY_BATCH_MAX = 100;

/**
 * A delay over 10 min comes from a clock off (the browser's against the
 * server's), not from the real time: the server drops it rather than correct it.
 */
export const LATENCY_MAX_DELAY_MS = 10 * 60_000;

/**
 * One measure of US-20: the event `seq` of `source` was applied by the page
 * `delayMs` after its source saw the change (`Date.now() - sourceAt`, the
 * browser's clock against the server's), at `at`. A delay over
 * `LATENCY_MAX_DELAY_MS` is valid here, and dropped by the server.
 */
export const zLatencySample = z.object({
  seq: zSeq,
  source: zEventSource,
  delayMs: z.int().nonnegative(),
  at: zInstant,
});
export type LatencySample = z.infer<typeof zLatencySample>;

/** `POST /api/metrics/latency` (204): the samples the page measured, 1 to `LATENCY_BATCH_MAX`. */
export const zLatencyBatch = z.object({ samples: z.array(zLatencySample).min(1).max(LATENCY_BATCH_MAX) });
export type LatencyBatch = z.infer<typeof zLatencyBatch>;
