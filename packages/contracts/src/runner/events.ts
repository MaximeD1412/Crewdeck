import { z } from 'zod';
import { zInstant, zUsdMicros } from '../values.js';

/**
 * The events of a Moteur, normalised (ADR 0004): every adapter turns its
 * provider's stream into these, named as `docs/spikes/engines.md` maps them
 * (RUNNER-1 added none). Each carries its `seq` (1, 2, … per Session), the
 * instant `at` the Runner read it, and `raw`, the provider's event as it came:
 * `raw` stays on the Runner, in its local log for debugging; the server's
 * schema of a relayed event drops it (SESSION-1).
 */
const engineEvent = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.object({
    kind: z.literal(kind),
    seq: z.int().positive(),
    at: zInstant,
    // In Go a json.RawMessage: the provider's bytes, as they came.
    raw: z.unknown().optional().meta({ goJSONSchema: { type: 'json.RawMessage', imports: ['encoding/json'], nillable: true } }),
    ...shape,
  });

/** The agent's text: deltas (`final: false`) while it streams, then the whole message (`final: true`). */
export const zEngineEventMessage = engineEvent('message', { from: z.literal('agent'), text: z.string(), final: z.boolean() });

/** A tool the agent calls: `target` what it acts on (a file, a command), `detail` the rest, both as the adapter shows them. */
export const zEngineEventToolCall = engineEvent('tool-call', {
  callId: z.string().min(1),
  tool: z.string().min(1),
  target: z.string().optional(),
  detail: z.string().optional(),
});

/** The outcome of the `tool-call` of the same `callId`. */
export const zEngineEventToolResult = engineEvent('tool-result', { callId: z.string().min(1), ok: z.boolean(), detail: z.string().optional() });

/** A question the agent asks the Pilote, answered with one option's label (several when `multiple`) or a text. */
export const zEngineEventQuestion = engineEvent('question', {
  requestId: z.string().min(1),
  title: z.string().min(1),
  options: z.array(z.object({ label: z.string().min(1), detail: z.string().optional() })),
  multiple: z.boolean(),
});

/** A tool call that waits for the Pilote's permission, answered allowed or not. */
export const zEngineEventPermissionRequest = engineEvent('permission-request', {
  requestId: z.string().min(1),
  tool: z.string().min(1),
  command: z.string(),
});

/** The windows of a Compte IA by subscription: the 5-hour one and the weekly one. */
export const USAGE_WINDOWS = ['five-hour', 'week'] as const;
export const zUsageWindowId = z.enum(USAGE_WINDOWS);
export type UsageWindowId = z.infer<typeof zUsageWindowId>;

/**
 * What the Compte IA has used: its windows (a subscription), the cost so far
 * (micro-dollars, cumulative per Moteur process; at list price on a
 * subscription) and the tokens, each when the Moteur reports it.
 */
export const zEngineEventUsage = engineEvent('usage', {
  windows: z
    .array(z.object({ id: zUsageWindowId, usedPercent: z.number().min(0).max(100), resetsAt: zInstant }))
    .optional(),
  costUsdMicros: zUsdMicros.optional(),
  inputTokens: z.int().nonnegative().optional(),
  outputTokens: z.int().nonnegative().optional(),
});

/** A window is full: the turn stops until `resetsAt`, when the Moteur says it. */
export const LIMIT_WINDOWS = [...USAGE_WINDOWS, 'unknown'] as const;
export const zEngineEventLimitReached = engineEvent('limit-reached', { window: z.enum(LIMIT_WINDOWS), resetsAt: zInstant.optional() });

/** The Compte IA is not signed in, or no longer: `reason` as the Moteur gives it. */
export const zEngineEventAuthRequired = engineEvent('auth-required', { reason: z.string() });

/**
 * The end of a turn: `interrupted` after `Interrupt`. `engineSessionId` is the
 * Moteur's own id of the Session, what `Resume` takes.
 */
export const RESULT_STATUSES = ['ok', 'error', 'interrupted'] as const;
export const zEngineEventResult = engineEvent('result', {
  status: z.enum(RESULT_STATUSES),
  engineSessionId: z.string().min(1).optional(),
  costUsdMicros: zUsdMicros.optional(),
});

/** An error of the Moteur: `code` the provider's (`model_not_found`) or the adapter's (`exit`), `message` as written. */
export const zEngineEventError = engineEvent('error', { code: z.string().min(1), message: z.string() });

export const zEngineEvent = z.discriminatedUnion('kind', [
  zEngineEventMessage,
  zEngineEventToolCall,
  zEngineEventToolResult,
  zEngineEventQuestion,
  zEngineEventPermissionRequest,
  zEngineEventUsage,
  zEngineEventLimitReached,
  zEngineEventAuthRequired,
  zEngineEventResult,
  zEngineEventError,
]);
export type EngineEvent = z.infer<typeof zEngineEvent>;
export type EngineEventKind = EngineEvent['kind'];
export const ENGINE_EVENT_KINDS = zEngineEvent.options.map((option) => option.shape.kind.value) as readonly EngineEventKind[];
