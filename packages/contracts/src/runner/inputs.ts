import { z } from 'zod';
import { zPermissionDecision } from './events.js';

/**
 * The plaintext of a `session.input` (SESSION-1), once the Runner opened it:
 * what the Pilote says to the agent of a Session: a `message`, the `answer`
 * to a question, the `permission`'s decision (SESSION-3). An answer to a
 * request no longer pending (answered from another tab) is ignored.
 */

/** The longest message: what the input's ciphertext holds. */
export const SESSION_MESSAGE_MAX = 100_000;

/** A message the Pilote writes to the agent. */
export const zSessionInputMessage = z.object({ kind: z.literal('message'), text: z.string().min(1).max(SESSION_MESSAGE_MAX) });

/** The most options one answer chooses. */
export const SESSION_ANSWER_OPTIONS_MAX = 100;

/** The answer to the question `requestId`: the indexes (from 0) of the options chosen, or a text of the Pilote's; one of them. */
export const zSessionInputAnswer = z
  .object({
    kind: z.literal('answer'),
    requestId: z.string().min(1).max(200),
    optionIndexes: z.array(z.int().nonnegative()).min(1).max(SESSION_ANSWER_OPTIONS_MAX).optional(),
    text: z.string().min(1).max(SESSION_MESSAGE_MAX).optional(),
  })
  .refine(({ optionIndexes, text }) => (optionIndexes === undefined) !== (text === undefined), { message: 'optionIndexes or text' });

/** The decision on the permission `requestId`. */
export const zSessionInputPermission = z.object({ kind: z.literal('permission'), requestId: z.string().min(1).max(200), decision: zPermissionDecision });

export const zSessionInputPayload = z.discriminatedUnion('kind', [zSessionInputMessage, zSessionInputAnswer, zSessionInputPermission]);
export type SessionInputPayload = z.infer<typeof zSessionInputPayload>;
