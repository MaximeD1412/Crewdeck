import { z } from 'zod';

/**
 * The value shapes of ADR 0008, defined here and nowhere else: a schema needing
 * an id, an instant, a day, an amount or a cursor uses these, never its own
 * `z.string().uuid()`.
 */

/** An id: a UUIDv7 string. */
export const zId = z.uuid({ version: 'v7' });
export type Id = z.infer<typeof zId>;

/** An instant: ISO 8601 in UTC, ending in `Z`, kept a string. */
export const zInstant = z.iso.datetime();
export type Instant = z.infer<typeof zInstant>;

/** A day: `YYYY-MM-DD`, never converted to an instant. */
export const zDay = z.iso.date();
export type Day = z.infer<typeof zDay>;

const zNonNegativeInt = z.int().nonnegative();

/** A cost as the provider bills it: integer micro-dollars. */
export const zUsdMicros = zNonNegativeInt;
export type UsdMicros = z.infer<typeof zUsdMicros>;

/** An amount in euro cents (a cost converted at its day's rate). */
export const zEurCents = zNonNegativeInt;
export type EurCents = z.infer<typeof zEurCents>;

/**
 * The real-time sequence number of ADR 0007. The page keeps it a `bigint` and
 * sends it as its decimal string (BigInt-safe in JSON); the server sends a
 * number. Both are read as a number, which stays a safe integer.
 */
export const zSeq = z.codec(z.union([zNonNegativeInt, z.string().regex(/^(0|[1-9][0-9]*)$/)]), zNonNegativeInt, {
  decode: (value) => Number(value),
  encode: (seq) => seq,
});
export type Seq = z.infer<typeof zSeq>;

/** A page of a list that only grows: its items, and the cursor of the next page (`null` at the end). */
export const zCursorPage = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** The query of a cursor list: `?cursor=…&limit=…`, 50 items by default, 100 at most. */
export const zCursorQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CursorQuery = z.infer<typeof zCursorQuery>;

/** A Rôle: the part of the Process an agent plays. */
export const AGENT_ROLES = ['idea', 'design', 'code', 'review'] as const;
export const zAgentRole = z.enum(AGENT_ROLES);
export type AgentRole = z.infer<typeof zAgentRole>;
