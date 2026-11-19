import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';
import { EXAMPLE_TEMPLATES, FolderProjectForm } from './folder-project-form.js';
import { EXAMPLE_REPOSITORIES, RepositoryPicker } from './repository-picker.js';

/** The two ways to create a Projet: a folder of the Runner's machine, or a Dépôt GitHub. */
export const PROJECT_ORIGINS = ['dossier', 'github'] as const;
export const zProjectOrigin = z.enum(PROJECT_ORIGINS);
export type ProjectOrigin = z.infer<typeof zProjectOrigin>;

const FOLDER: z.input<typeof FolderProjectForm.data> = {
  context: 'projets',
  path: '',
  check: { state: 'idle', hasCode: false },
  name: '',
  templates: [...EXAMPLE_TEMPLATES],
  templateId: 'process-crewdeck',
  busy: false,
  vaultLocked: false,
  machine: 'atelier-pc',
};
const PICKER: z.input<typeof RepositoryPicker.data> = {
  context: 'projets',
  repositories: [...EXAMPLE_REPOSITORIES],
  installUrl: 'https://github.com/apps/crewdeck/installations/new?state=projets',
  busy: false,
  templates: [...EXAMPLE_TEMPLATES],
  templateId: 'process-crewdeck',
};

/**
 * « Ajouter un Projet » (US-3, `/projets/ajouter`): its PageHeader (back
 * « Projets »), Tabs « Dossier sur ta machine » and « Dépôt GitHub »
 * (`selectTab`), then the FolderProjectForm of `folder` or the
 * RepositoryPicker of `picker`, whose actions go up to the page's dispatcher.
 * With `repick` (`?projet=<id>`), the title « Choisir le dossier de <name> »
 * and the `repick` form only.
 */
export const PageAjouterProjet = defineComposant({
  name: 'PageAjouterProjet',
  version: 1,
  tag: 'cd-page-ajouter-projet',
  category: 'page',
  description: 'L’ajout d’un Projet : un dossier de ta machine ou un Dépôt GitHub.',
  data: z.object({
    tab: zProjectOrigin,
    folder: FolderProjectForm.data,
    picker: RepositoryPicker.data,
    repick: z.object({ projectId: zId, name: z.string() }).nullable(),
  }),
  actions: { selectTab: z.object({ id: zProjectOrigin }) },
  slots: [],
  examples: [
    { name: 'dossier', data: { tab: 'dossier', folder: FOLDER, picker: PICKER, repick: null } },
    { name: 'Dépôt GitHub', data: { tab: 'github', folder: FOLDER, picker: PICKER, repick: null } },
    {
      name: 'choisir à nouveau',
      data: {
        tab: 'dossier',
        folder: { ...FOLDER, context: 'repick', name: 'Recettes' },
        picker: PICKER,
        repick: { projectId: '019a6f00-0000-7000-8000-000000000021', name: 'Recettes' },
      },
    },
  ],
});
