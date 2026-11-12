import type { InstallReturn, Project, Repository } from '@crewdeck/contracts';
import type { ComposantData, PageProjets, RepositoryPicker } from '@crewdeck/sdk';

export type ProjetsView = ComposantData<typeof PageProjets>;
export type PickerView = ComposantData<typeof RepositoryPicker>;

const compare = (a: string, b: string): number => a.localeCompare(b, 'fr');

/** « Projets »' data (pure): every Projet of the `project` slice, by name then Dépôt GitHub. */
export const projetsView = (projects: Iterable<Project>): ProjetsView => ({
  projects: [...projects]
    .sort((a, b) => compare(a.displayName, b.displayName) || compare(a.fullName, b.fullName))
    .map(({ id, displayName, fullName }) => ({ id, displayName, fullName })),
});

export interface PickerState {
  readonly context: InstallReturn;
  /** The `repository` slice. */
  readonly repositories: Iterable<Repository>;
  /** GitHub's installation page, `null` until the page read its config. */
  readonly installUrl: string | null;
  readonly busy: boolean;
}

/** The RepositoryPicker's data (pure): the Dépôts GitHub not followed, by name then owner. */
export const pickerView = ({ context, repositories, installUrl, busy }: PickerState): PickerView => ({
  context,
  repositories: [...repositories]
    .filter((repository) => !repository.followed)
    .sort((a, b) => compare(a.name, b.name) || compare(a.owner, b.owner))
    .map(({ id, fullName, hasCode }) => ({ id, fullName, hasCode })),
  installUrl,
  busy,
});
