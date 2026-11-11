import { z } from 'zod';
import { zId } from '../values.js';

/**
 * `GET /api/me`: the signed-in Pilote, 401 `auth.required` for nobody (the
 * page then goes to `/connexion`). RUNNER-3 adds `gettingStartedStep`.
 */
export const zMe = z.object({
  id: zId,
  login: z.string().min(1),
  avatarUrl: z.url().nullable(),
  /** IANA, the browser's at the first sign-in. */
  timeZone: z.string().min(1),
});
export type Me = z.infer<typeof zMe>;
