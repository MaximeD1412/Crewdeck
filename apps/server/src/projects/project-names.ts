export interface ProjectNames {
  readonly displayName: string;
  readonly integrationBranch: string;
  readonly releaseBranch: string;
}

/** The integration branch of a newly followed Projet, until the Pilote changes it in its Paramètres (PARAM-3). */
export const DEFAULT_INTEGRATION_BRANCH = 'develop';

/**
 * The name and branches of a newly followed Projet, from its repository
 * alone (ADR 0011): its name, `develop` and its default branch. No file of
 * the repository is read.
 */
export const projectNamesOf = (repository: { name: string; defaultBranch: string }): ProjectNames => ({
  displayName: repository.name,
  integrationBranch: DEFAULT_INTEGRATION_BRANCH,
  releaseBranch: repository.defaultBranch,
});
