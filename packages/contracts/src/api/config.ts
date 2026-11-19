import { z } from 'zod';

/**
 * `GET /api/config`, public: where the page reads GitHub with the Pilote's
 * user token (ADR 0002), and the App's slug for its installation page.
 * GitHub's own URLs in production, the server's `/fake-github` with the fakes.
 * And the server the Runner's install command names with `--server`
 * (RUNNER-3): `null` in production, where `install.sh` knows it already.
 * And the VAPID public key `pushManager.subscribe` is given (ATOI-4).
 */
export const zPublicConfig = z.object({
  githubApiUrl: z.url(),
  githubWebUrl: z.url(),
  appSlug: z.string().min(1),
  runnerServer: z.url().nullable(),
  /** The server's VAPID public key, base64url: the `applicationServerKey` of a push subscription. */
  vapidPublicKey: z.string().regex(/^[A-Za-z0-9_-]+$/),
});
export type PublicConfig = z.infer<typeof zPublicConfig>;
