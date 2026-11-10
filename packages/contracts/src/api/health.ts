import { z } from 'zod';

/** `GET /api/health`: public, returns no secret, only the commit. */
export const zHealth = z.object({
  status: z.literal('ok'),
  commit: z.string(),
  db: z.enum(['ok', 'down']),
});
export type Health = z.infer<typeof zHealth>;
