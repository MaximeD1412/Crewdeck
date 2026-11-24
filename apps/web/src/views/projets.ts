import {
  PROCESS_CREWDECK_NAME,
  processSourcesOf,
  type InstallReturn,
  type ProcessTemplate,
  type ProcessTemplateId,
  type Project,
  type ProjectProcess,
  type Repository,
} from '@crewdeck/contracts';
import { t, type ComposantData, type FolderProjectForm, type PageAjouterProjet, type PageProjet, type PageProjets, type ProjectOrigin, type RepositoryPicker } from '@crewdeck/sdk';

export type ProjetsView = ComposantData<typeof PageProjets>;
export type PickerView = ComposantData<typeof RepositoryPicker>;
export type FolderFormView = ComposantData<typeof FolderProjectForm>;
export type AjouterView = ComposantData<typeof PageAjouterProjet>;
export type ProjetView = ComposantData<typeof PageProjet>;

/** A Projet's name as the page shows it (`projects.ts`, `projectName`). */
export type NameOf = (project: Project) => string;

/** The Modèles de process of the release a new Projet may start from (US-97): « Process Crewdeck ». */
export const PROCESS_TEMPLATES: readonly { readonly id: ProcessTemplateId; readonly label: string }[] = [{ id: 'process-crewdeck', label: PROCESS_CREWDECK_NAME }];
export const DEFAULT_TEMPLATE_ID: ProcessTemplateId = 'process-crewdeck';

/** The Pilote's own Modèles a new Projet may start from, and whether this page's vault is locked (PROCESS-14). */
export interface TemplateChoice {
  readonly templates?: Iterable<ProcessTemplate>;
  readonly vaultLocked?: boolean;
}

/**
 * The Select « Modèle de process » (US-97, PROCESS-14): « Process Crewdeck »
 * first and chosen, then the Pilote's Modèles by name; one with Commandes is
 * disabled while the vault is locked, the page unable to seal them again.
 */
const templates = ({ templates: own = [], vaultLocked = false }: TemplateChoice = {}) => ({
  templates: [
    ...PROCESS_TEMPLATES.map(({ id, label }) => ({ id, label })),
    ...[...own]
      .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id))
      .map(({ id, name, sealed }) => ({ id, label: name, ...(sealed !== null && vaultLocked ? { disabled: true } : {}) })),
  ],
  templateId: DEFAULT_TEMPLATE_ID,
});

const compare = (a: string, b: string): number => a.localeCompare(b, 'fr');

/** The machine a Local Projet's folder is on: the Runner's, else « ta machine ». */
const machineOr = (machine: string | null): string => machine ?? t('projets.local.thisMachine');

/** A Projet's line under its name: its Dépôt GitHub, or « Local · sur <machine> », « Local · dossier introuvable ». */
export const projectMeta = (project: Pick<Project, 'fullName' | 'folder'>, machine: string | null): string => {
  if (project.fullName !== null) return project.fullName;
  return project.folder === 'missing' ? t('projets.meta.missing') : t('projets.meta.local', { machine: machineOr(machine) });
};

/** « Projets »' data (pure): every Projet of the `project` slice, by name then meta. `machine` is the Runner's. */
export const projetsView = (projects: Iterable<Project>, { name, machine }: { readonly name: NameOf; readonly machine: string | null }): ProjetsView => ({
  projects: [...projects]
    .map((project) => ({ id: project.id, name: name(project), meta: projectMeta(project, machine) }))
    .sort((a, b) => compare(a.name, b.name) || compare(a.meta, b.meta)),
});

export interface PickerState extends TemplateChoice {
  readonly context: InstallReturn;
  /** The `repository` slice. */
  readonly repositories: Iterable<Repository>;
  /** GitHub's installation page, `null` until the page read its config. */
  readonly installUrl: string | null;
  readonly busy: boolean;
}

/** The RepositoryPicker's data (pure): the Dépôts GitHub not followed, by name then owner, and the Modèles de process. */
export const pickerView = ({ context, repositories, installUrl, busy, ...choice }: PickerState): PickerView => ({
  context,
  repositories: [...repositories]
    .filter((repository) => !repository.followed)
    .sort((a, b) => compare(a.name, b.name) || compare(a.owner, b.owner))
    .map(({ id, fullName, hasCode }) => ({ id, fullName, hasCode })),
  installUrl,
  busy,
  ...templates(choice),
});

/** The tab « Ajouter un Projet » opens first: « Dépôt GitHub » when the Pilote has one, else « Dossier sur ta machine ». */
export const firstTab = (repositories: Iterable<Repository>): ProjectOrigin => ([...repositories].length > 0 ? 'github' : 'dossier');

export interface FolderFormState {
  readonly context: FolderFormView['context'];
  readonly path: string;
  readonly check: FolderFormView['check'];
  /** The name the form proposes: the folder's, or the Projet's when choosing its folder again. */
  readonly name: string;
  readonly busy: boolean;
  readonly vaultLocked: boolean;
  readonly machine: string | null;
  /** The Pilote's own Modèles de process (PROCESS-14). */
  readonly templates?: Iterable<ProcessTemplate>;
}

/** The FolderProjectForm's data (pure), with the Modèles de process. */
export const folderFormView = ({ templates: own, ...state }: FolderFormState): FolderFormView => ({
  ...state,
  ...templates({ vaultLocked: state.vaultLocked, ...(own === undefined ? {} : { templates: own }) }),
});

/** The Connecteurs of a Projet: its groups' Sources other than Local; without its Process yet, GitHub for a Dépôt GitHub. */
const connectorsOf = (project: Project, process: ProjectProcess | undefined): ProjetView['connectors'] => {
  if (!process) return project.repositoryId !== null ? ['github'] : [];
  const kinds = new Set(Object.values(processSourcesOf(process)));
  return [...kinds].filter((kind): kind is 'github' => kind !== null && kind !== 'local');
};

/** A Projet's page (pure, `/projets/:id`): its name, its Dépôt GitHub or its folder on the Runner's machine, its Connecteurs. */
export const projetView = (
  project: Project,
  { name, machine, process }: { readonly name: NameOf; readonly machine: string | null; readonly process: ProjectProcess | undefined },
): ProjetView => ({
  id: project.id,
  name: name(project),
  fullName: project.fullName,
  folder: project.folder === null ? null : { state: project.folder, machine },
  connectors: connectorsOf(project, process),
  followedAt: project.followedAt,
});
