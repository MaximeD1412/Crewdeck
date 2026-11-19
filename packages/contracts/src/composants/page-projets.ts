import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';

/**
 * « Projets » (US-3, `/projets`): the page's title with the count and
 * « Ajouter un Projet » (`add`), then the Card « Prêts pour le Process ? »
 * with a ListRow per Projet, its name and its `meta` (its Dépôt GitHub, or
 * « Local · sur <machine> », « Local · dossier introuvable »), a link to
 * `/projets/<id>`. Without any, an Empty and « Ajouter un Projet ». Their
 * readiness (PROJET-3) adds its badge and its meta.
 */
export const PageProjets = defineComposant({
  name: 'PageProjets',
  version: 2,
  tag: 'cd-page-projets',
  category: 'page',
  description: 'Les Projets suivis, et l’ajout d’un dossier ou d’un Dépôt GitHub.',
  data: z.object({ projects: z.array(z.object({ id: zId, name: z.string().min(1), meta: z.string() })) }),
  actions: { add: z.object({}) },
  slots: [],
  examples: [
    {
      name: 'des Projets',
      data: {
        projects: [
          { id: '019a6f00-0000-7000-8000-000000000011', name: 'Personal OS', meta: 'MaximeD1412/personal-os' },
          { id: '019a6f00-0000-7000-8000-000000000012', name: 'Crewdeck', meta: 'MaximeD1412/crewdeck' },
          { id: '019a6f00-0000-7000-8000-000000000021', name: 'Recettes', meta: 'Local · sur atelier-pc' },
        ],
      },
    },
    { name: 'aucun Projet', data: { projects: [] } },
  ],
});
