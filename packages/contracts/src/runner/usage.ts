import { z } from 'zod';
import { zId, zInstant, zUsdMicros } from '../values.js';
import { ENGINE_IDS } from './engines.js';
import { runnerMessage } from './envelope.js';
import { zUsageWindowId } from './events.js';

/** The Comptes IA that have a usage: a subscription (its windows) or an API key (its spend). */
export const USAGE_ACCOUNT_KINDS = ['subscription', 'api-key'] as const;
export const zUsageAccountKind = z.enum(USAGE_ACCOUNT_KINDS);
export type UsageAccountKind = z.infer<typeof zUsageAccountKind>;

/** A window of a subscription as the Moteur last reported it: how much is used, and when it resets. */
export const zUsageWindowMeasure = z.object({ id: zUsageWindowId, usedPercent: z.number().min(0).max(100), resetsAt: zInstant });
export type UsageWindowMeasure = z.infer<typeof zUsageWindowMeasure>;

/**
 * Runner → server (US-55, RUNNER-13): the usage of one Compte IA, figures
 * only, never content (ADR 0004). `windows` as the adapter last reported
 * them (a `usage` or a `limit-reached`), at `measuredAt`; or `spend`, what a
 * Session's `result` adds to its cost so far, in micro-dollars as the
 * provider bills it, alone (`windows` empty) at the result's instant, so that
 * a spend is never dated by older windows. Sent at each `usage` and
 * `limit-reached`, at each `result` that adds a cost, and every
 * `USAGE_EVERY_SECONDS` for what could not be sent. The server ignores the
 * spend of a subscription: its cost is a share of its windows (PILOTAGE-3).
 */
export const zUsage = runnerMessage('usage', {
  // The enum without its id: `contracts.EngineId` is written once, with the capabilities.
  engine: z.enum(ENGINE_IDS),
  accountKind: zUsageAccountKind,
  windows: z.array(zUsageWindowMeasure).max(2),
  spend: z.object({ sessionId: zId.optional(), costUsdMicros: zUsdMicros }).optional(),
  measuredAt: zInstant,
});
export type Usage = z.infer<typeof zUsage>;

/** How often the Runner sends the windows its Sessions reported since its last usage. */
export const USAGE_EVERY_SECONDS = 10 * 60;
