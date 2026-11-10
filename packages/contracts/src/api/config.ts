import { z } from 'zod';

/**
 * `GET /api/config`, public: where the page reads GitHub with the Pilote's
 * user token (ADR 0002), and the App's slug for its installation page.
 * GitHub's own URLs in production, the server's `/fake-github` with the fakes.
 */
export const zPublicConfig = z.object({
  githubApiUrl: z.url(),
  githubWebUrl: z.url(),
  appSlug: z.string().min(1),
});
export type PublicConfig = z.infer<typeof zPublicConfig>;
