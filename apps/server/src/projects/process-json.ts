import { z } from 'zod';

/** What following a Projet reads of a `.process.json` already in the repository: its name and its branches, each optional. */
const zProcessJsonNames = z.object({
  projectName: z.string().trim().min(1).max(100).optional().catch(undefined),
  branches: z
    .object({
      integration: z.string().trim().min(1).max(255).optional().catch(undefined),
      release: z.string().trim().min(1).max(255).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

export interface ProjectNames {
  readonly displayName: string;
  readonly integrationBranch: string;
  readonly releaseBranch: string;
}

/** Without `.process.json`, the integration branch of the Process. */
export const DEFAULT_INTEGRATION_BRANCH = 'develop';

/**
 * The Projet's name and branches: those of `.process.json` when it has them
 * (`projectName`, `branches.integration`, `branches.release`), else the
 * repository's name, `develop` and its default branch. A file of another
 * shape is read for what it has; PROJET-3 checks it.
 */
export const projectNamesOf = (processJson: unknown, repository: { name: string; defaultBranch: string }): ProjectNames => {
  const parsed = zProcessJsonNames.safeParse(processJson);
  const names = parsed.success ? parsed.data : {};
  return {
    displayName: names.projectName ?? repository.name,
    integrationBranch: names.branches?.integration ?? DEFAULT_INTEGRATION_BRANCH,
    releaseBranch: names.branches?.release ?? repository.defaultBranch,
  };
};
