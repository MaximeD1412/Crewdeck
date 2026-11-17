import { z } from 'zod';

/** A GitHub owner (a user or an organisation), as GitHub allows it. */
export const zGitHubOwner = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/);

/** A GitHub repository's name, as GitHub allows it, never `.` nor `..`. */
export const zGitHubRepoName = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/)
  .refine((name) => name !== '.' && name !== '..');

/**
 * Where a Projet's code comes from (ADR 0012), as the Runner reads it in a
 * `session.start` (RUNNER-9) and a `command.run` (RUNNER-18): a GitHub
 * repository, which the Runner clones under
 * `~/.crewdeck/repos/github/<owner>/<name>`. SOURCE-2 adds the kind `local`.
 */
export const ORIGIN_KINDS = ['github'] as const;
export const zOrigin = z.object({ kind: z.enum(ORIGIN_KINDS), owner: zGitHubOwner, name: zGitHubRepoName });
export type Origin = z.infer<typeof zOrigin>;
