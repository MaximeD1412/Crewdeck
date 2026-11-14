import { z } from 'zod';
import { zEngineId } from '../runner/engines.js';
import { zUsageWindowId } from '../runner/events.js';
import { zUsageAccountKind } from '../runner/usage.js';
import { zEurCents, zId, zInstant, zUsdMicros } from '../values.js';

/**
 * A window of a subscription (US-55): its last measure, and where the pace of
 * the window's last 24 hours leads. `exhaustsAt` when the window runs out
 * before it resets; `holdsUntilReset` when the pace is known and it does not
 * (« tient jusqu'à la réinitialisation »); neither while no pace is known (one
 * measure, or measures over less than 30 minutes). `projectedPercent`, with a
 * pace: the percent used at the reset at that pace, 100 at most.
 */
export const zUsageWindow = z.object({
  id: zUsageWindowId,
  usedPercent: z.number().min(0).max(100),
  resetsAt: zInstant,
  exhaustsAt: zInstant.optional(),
  holdsUntilReset: z.boolean(),
  projectedPercent: z.number().min(0).max(100).optional(),
  measuredAt: zInstant,
});
export type UsageWindow = z.infer<typeof zUsageWindow>;

/**
 * The spend of the current calendar month, in the Pilote's time zone, of an
 * API key: in micro-dollars as the provider bills it, and in euro cents
 * converted at each spend's day rate (always « estimée »). `costEurCents` is
 * `null` while a spend of the month has no rate yet (before the first ECB
 * rate is known).
 */
export const zUsageMonthSpend = z.object({ costUsdMicros: zUsdMicros, costEurCents: zEurCents.nullable() });
export type UsageMonthSpend = z.infer<typeof zUsageMonthSpend>;

/**
 * The usage of a Compte IA (US-55, RUNNER-13), its `id` the Compte IA's: a
 * subscription's windows, an API key's month spend. An item of
 * `GET /api/usage`, the payload of `usage.upserted`, and the `usage` slice of
 * `GET /api/state`. `measuredAt` is its last measure or spend.
 */
export const zUsageAccount = z.object({
  id: zId,
  engine: zEngineId,
  kind: zUsageAccountKind,
  windows: z.array(zUsageWindow),
  monthSpend: zUsageMonthSpend.optional(),
  measuredAt: zInstant,
});
export type UsageAccount = z.infer<typeof zUsageAccount>;

/** `GET /api/usage` (session): the usage of the Pilote's Comptes IA that have one, in the order of the Moteurs' ids. */
export const zUsageList = z.object({ accounts: z.array(zUsageAccount) });
export type UsageList = z.infer<typeof zUsageList>;
