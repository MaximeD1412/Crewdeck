import { z } from 'zod';
import { zId, zInstant } from '../values.js';

/**
 * What every message of the Runner protocol carries, both ways: its `type`,
 * an `id` (a UUIDv7 its sender generates, to name it in a log or an answer)
 * and the instant `at` it was sent. Its own fields sit beside them, flat.
 */
export const zRunnerEnvelope = z.object({ type: z.string().min(1), id: zId, at: zInstant });
export type RunnerEnvelope = z.infer<typeof zRunnerEnvelope>;

/** A message of the protocol: the envelope, its `type` a literal, and its own fields. */
export const runnerMessage = <T extends string, S extends z.ZodRawShape = Record<never, never>>(type: T, shape?: S) =>
  z.object({ type: z.literal(type), id: zId, at: zInstant, ...(shape ?? ({} as S)) });
