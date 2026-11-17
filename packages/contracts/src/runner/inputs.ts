import { z } from 'zod';

/**
 * The plaintext of a `session.input` (SESSION-1), once the Runner opened it:
 * what the Pilote says to the agent of a Session. A `message` now; SESSION-3
 * adds the answer to a question and the answer to a permission.
 */

/** The longest message: what the input's ciphertext holds. */
export const SESSION_MESSAGE_MAX = 100_000;

/** A message the Pilote writes to the agent. */
export const zSessionInputMessage = z.object({ kind: z.literal('message'), text: z.string().min(1).max(SESSION_MESSAGE_MAX) });

export const zSessionInputPayload = z.discriminatedUnion('kind', [zSessionInputMessage]);
export type SessionInputPayload = z.infer<typeof zSessionInputPayload>;
