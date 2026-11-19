import { z } from 'zod';

/** A GitHub owner (a user or an organisation), as GitHub allows it. */
export const zGitHubOwner = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/);

/** A GitHub repository's name, as GitHub allows it, never `.` nor `..`. */
export const zGitHubRepoName = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,100}$/)
  .refine((name) => name !== '.' && name !== '..');

/** A GitHub repository, which the Runner clones under `~/.crewdeck/repos/github/<owner>/<name>`. */
export const zGitHubOrigin = z.object({ kind: z.literal('github'), owner: zGitHubOwner, name: zGitHubRepoName });

/**
 * A Local Projet's folder (SOURCE-2), which the Runner clones under
 * `~/.crewdeck/repos/local/<projectId>` with the folder as `origin`: its path
 * is never sent, the Runner knows it from its own state (PROJET-6).
 */
export const zLocalOrigin = z.object({ kind: z.literal('local') });

/**
 * Where a Projet's code comes from (ADR 0012), as the Runner reads it in a
 * `session.start` (RUNNER-9) and a `command.run` (RUNNER-18): a GitHub
 * repository, or a Local Projet's folder.
 */
export const ORIGIN_KINDS = ['github', 'local'] as const;
export const zOriginUnion = z.discriminatedUnion('kind', [zGitHubOrigin, zLocalOrigin]);
/**
 * `goJSONSchema` names the Go type go-jsonschema gives the field, which it
 * cannot type from a `oneOf`: the union `contracts.Origin` that
 * `contracts:generate` writes from `zOriginUnion` (registry's `goUnions`).
 */
export const zOrigin = zOriginUnion.meta({ goJSONSchema: { type: 'Origin' } });
export type Origin = z.infer<typeof zOrigin>;
