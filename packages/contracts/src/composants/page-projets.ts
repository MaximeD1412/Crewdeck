import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';
import { zTone } from './tone.js';

/**
 * « Projets » (US-3, `/projets`): the page's title with the count and
 * « Ajouter un Projet » (`add`), then the Card « Prêts pour le Process ? »
 * with a ListRow per Projet, its name and its `meta` (its Dépôt GitHub, or
 * « Local · sur <machine> », « Local · dossier introuvable »), a link to
 * `/projets/<id>`, its readiness (PROJET-3) as its tone and its badge
 * (« prêt », « à régler », « inventaire »), the point to fix in its `meta`.
 * Without any, an Empty and « Ajouter un Projet ».
 */
export const PageProjets = defineComposant({
  name: 'PageProjets',
  version: 3,
  tag: 'cd-page-projets',
  category: 'page',
  description: 'Les Projets suivis, et l’ajout d’un dossier ou d’un Dépôt GitHub.',
  data: z.object({
    projects: z.array(z.object({ id: zId, name: z.string().min(1), meta: z.string(), tone: zTone, badge: z.string().min(1) })),
  }),
  actions: { add: z.object({}) },
  slots: [],
  examples: [
    {
      name: 'des Projets',
      data: {
        projects: [
          { id: '019a6f00-0000-7000-8000-000000000011', name: 'Personal OS', meta: 'MaximeD1412/personal-os', tone: 'go', badge: 'prêt' },
          { id: '019a6f00-0000-7000-8000-000000000013', name: 'Site mairie', meta: '1 point à régler : branche d’intégration absente', tone: 'caution', badge: 'à régler' },
          { id: '019a6f00-0000-7000-8000-000000000012', name: 'Tennis Manager', meta: 'Inventaire à approuver avant le Process', tone: 'accent', badge: 'inventaire' },
          { id: '019a6f00-0000-7000-8000-000000000021', name: 'Recettes', meta: 'Local · sur atelier-pc', tone: 'go', badge: 'prêt' },
        ],
      },
    },
    { name: 'aucun Projet', data: { projects: [] } },
  ],
});
