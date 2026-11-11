import { z } from 'zod';
import { zInstant } from '../values.js';

/**
 * `POST /api/github/token`: the Pilote's GitHub user token, with which the
 * page reads content from GitHub (ADR 0002), refreshed by the server when
 * less than 5 minutes remain. The page keeps it in memory only.
 */
export const zGithubToken = z.object({
  accessToken: z.string().min(1),
  expiresAt: zInstant,
});
export type GithubToken = z.infer<typeof zGithubToken>;
