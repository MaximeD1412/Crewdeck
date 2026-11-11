import { z } from 'zod';

/**
 * `GET /api/config`, public: where the page reads GitHub with the Pilote's
 * user token (ADR 0002), and the App's slug for its installation page.
 * GitHub's own URLs in production, the server's `/fake-github` with the fakes.
 * And the server the Runner's install command names with `--server`
 * (RUNNER-3): `null` in production, where `install.sh` knows it already.
 */
export const zPublicConfig = z.object({
  githubApiUrl: z.url(),
  githubWebUrl: z.url(),
  appSlug: z.string().min(1),
  runnerServer: z.url().nullable(),
});
export type PublicConfig = z.infer<typeof zPublicConfig>;
