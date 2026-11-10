import { z } from 'zod';
import { zInstant } from '../values.js';

/**
 * `GET /api/health`: public, returns no secret, only the commit and, in
 * production, the instant of the last successful backup (INFRA-8), which
 * GitHub watches (`.github/workflows/backup-watch.yml`). `backup` is absent
 * where nothing is backed up (staging, development); `lastSuccessAt` is null
 * while no backup has succeeded.
 */
export const zHealth = z.object({
  status: z.literal('ok'),
  commit: z.string(),
  db: z.enum(['ok', 'down']),
  backup: z.object({ lastSuccessAt: zInstant.nullable() }).optional(),
});
export type Health = z.infer<typeof zHealth>;
