import { z } from 'zod';
import { FOLLOW_PROJECTS_MAX, zInstallReturn } from '../api/projects.js';
import { zId } from '../values.js';
import { defineComposant } from './define.js';

/** How many the picker follows at once, for a Skin to say it (it imports no `api/`). */
export { FOLLOW_PROJECTS_MAX };

const INSTALL_URL = 'https://github.com/apps/crewdeck/installations/new?state=projets';

/** The Dépôts GitHub of the examples: three with code, one empty. */
export const EXAMPLE_REPOSITORIES = [
  { id: '019a6f00-0000-7000-8000-000000000001', fullName: 'MaximeD1412/personal-os', hasCode: true },
  { id: '019a6f00-0000-7000-8000-000000000002', fullName: 'MaximeD1412/site-mairie', hasCode: true },
  { id: '019a6f00-0000-7000-8000-000000000003', fullName: 'MaximeD1412/tennis-manager', hasCode: true },
  { id: '019a6f00-0000-7000-8000-000000000004', fullName: 'MaximeD1412/sandbox-vue3', hasCode: false },
] as const;

/**
 * The choice of the Dépôts GitHub to follow (US-3): on `/projets/ajouter`
 * (`context: 'projets'`, under its own PageHeader and its explanation) and as
 * the Projets' step of « Premiers pas » (`context: 'demarrage'`, under the
 * page's title, with « Plus tard », `later`). A search field filtering the
 * list in the page, a Checkbox per Dépôt GitHub not followed yet (« déjà du
 * code · un inventaire sera proposé » or « vide »), « Suivre <n> Projets »
 * (`follow`, disabled at none), the Inventaire's footnote and the link to
 * GitHub's installation page that chooses other repositories (`installUrl`,
 * `null` until the page knows it). Without any Dépôt GitHub, an Empty whose
 * action is that link. `busy` while the command is on its way.
 */
export const RepositoryPicker = defineComposant({
  name: 'RepositoryPicker',
  version: 1,
  tag: 'cd-repository-picker',
  category: 'partie',
  description: 'Le choix des Dépôts GitHub à suivre, chacun devenant un Projet.',
  data: z.object({
    context: zInstallReturn,
    repositories: z.array(z.object({ id: zId, fullName: z.string().min(1), hasCode: z.boolean() })),
    installUrl: z.url().nullable(),
    busy: z.boolean(),
  }),
  actions: { follow: z.object({ repositoryIds: z.array(zId).min(1).max(FOLLOW_PROJECTS_MAX) }), later: z.object({}) },
  slots: [],
  examples: [
    { name: 'tes dépôts', data: { context: 'projets', repositories: [...EXAMPLE_REPOSITORIES], installUrl: INSTALL_URL, busy: false } },
    { name: 'aucun dépôt', data: { context: 'projets', repositories: [], installUrl: INSTALL_URL, busy: false } },
    {
      name: 'Premiers pas',
      data: { context: 'demarrage', repositories: [...EXAMPLE_REPOSITORIES], installUrl: 'https://github.com/apps/crewdeck/installations/new?state=demarrage', busy: false },
    },
  ],
});
