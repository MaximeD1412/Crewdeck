import type { UsageWindowId } from '@crewdeck/contracts';

/** A measure of a window: how much was used at `measuredAt`, and when the window resets. */
export interface WindowMeasure {
  readonly usedPercent: number;
  readonly resetsAt: Date;
  readonly measuredAt: Date;
}

/**
 * Where the pace leads: the instant the window runs out, or that it holds
 * until it resets; neither without a pace. `atReset`: the percent used at the
 * reset at that pace (100 at most, to a tenth), `null` without a pace.
 */
export interface Projection {
  readonly exhaustsAt: Date | null;
  readonly holdsUntilReset: boolean;
  readonly atReset: number | null;
}

const HOUR_MS = 60 * 60 * 1000;
/** How long each window lasts: the current one starts that long before it resets. */
export const WINDOW_MS: Readonly<Record<UsageWindowId, number>> = { 'five-hour': 5 * HOUR_MS, week: 7 * 24 * HOUR_MS };
/** The measures the pace reads: the last 24 hours. */
export const PACE_OVER_MS = 24 * HOUR_MS;
/** The least span of measures that gives a pace. */
export const PACE_MIN_SPAN_MS = 30 * 60 * 1000;

const NONE: Projection = { exhaustsAt: null, holdsUntilReset: false, atReset: null };

/**
 * The projection of a window at the current pace (US-55): from the measures
 * of the current window (those after it started, `WINDOW_MS` before its
 * reset) over the last 24 hours, at least two over 30 minutes, the pace is
 * linear in % an hour from the first to the last; the window runs out at
 * `now + (100 - used) / pace`, or holds when that is after its reset (or
 * nothing is used any more). Nothing without a pace, or once the window is
 * used up. `measures` in any order.
 */
export const project = (window: UsageWindowId, measures: readonly WindowMeasure[], now: Date): Projection => {
  const sorted = [...measures].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
  const last = sorted.at(-1);
  if (!last || last.usedPercent >= 100) return NONE;
  const since = Math.max(now.getTime() - PACE_OVER_MS, last.resetsAt.getTime() - WINDOW_MS[window]);
  const current = sorted.filter((measure) => measure.measuredAt.getTime() > since);
  const first = current[0];
  if (!first || current.length < 2) return NONE;
  const spanMs = last.measuredAt.getTime() - first.measuredAt.getTime();
  if (spanMs < PACE_MIN_SPAN_MS) return NONE;
  const perHour = (last.usedPercent - first.usedPercent) / (spanMs / HOUR_MS);
  if (perHour <= 0) return { exhaustsAt: null, holdsUntilReset: true, atReset: last.usedPercent };
  const exhaustsAt = new Date(now.getTime() + ((100 - last.usedPercent) / perHour) * HOUR_MS);
  if (exhaustsAt.getTime() <= last.resetsAt.getTime()) return { exhaustsAt, holdsUntilReset: false, atReset: 100 };
  const atReset = last.usedPercent + (perHour * (last.resetsAt.getTime() - now.getTime())) / HOUR_MS;
  return { exhaustsAt: null, holdsUntilReset: true, atReset: Math.min(100, Math.round(atReset * 10) / 10) };
};
