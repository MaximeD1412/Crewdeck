import { z } from 'zod';
import { zProjectFolderState } from '../api/projects.js';
import { zSourceKind } from '../process/sources.js';
import { zId, zInstant } from '../values.js';
import { defineComposant } from './define.js';

const LOCAL = {
  id: '019a6f00-0000-7000-8000-000000000021',
  name: 'Recettes',
  fullName: null,
  folder: { state: 'present', machine: 'atelier-pc' },
  connectors: [],
  followedAt: '2026-11-10T09:00:00.000Z',
} as const;

/**
 * A Projet's page (`/projets/:id`): its PageHeader (back « Projets »,
 * « Gestion du process », `openProcess`), then the Card « Projet »: its
 * Dépôt GitHub, or its folder (« sur <machine> », « en attente du Runner »
 * while `pending`, « introuvable » when `missing`; never its path, which only
 * the Runner keeps), its Connecteurs (« aucun : tout est Local » when none),
 * « Suivi depuis ». A Local Projet adds the neutral Banner « Des fichiers que
 * tu lis à la main ». Its readiness Card is PROJET-3's.
 */
export const PageProjet = defineComposant({
  name: 'PageProjet',
  version: 1,
  tag: 'cd-page-projet',
  category: 'page',
  description: 'Un Projet : son dossier ou son Dépôt GitHub, ses Connecteurs.',
  data: z.object({
    id: zId,
    name: z.string().min(1),
    fullName: z.string().min(1).nullable(),
    folder: z.object({ state: zProjectFolderState, machine: z.string().nullable() }).nullable(),
    connectors: z.array(zSourceKind.exclude(['local'])),
    followedAt: zInstant,
  }),
  actions: { openProcess: z.object({}) },
  slots: [],
  examples: [
    { name: 'Projet local', data: LOCAL },
    { name: 'en attente du Runner', data: { ...LOCAL, folder: { state: 'pending', machine: 'atelier-pc' } } },
    { name: 'dossier introuvable', data: { ...LOCAL, folder: { state: 'missing', machine: 'atelier-pc' } } },
    {
      name: 'Dépôt GitHub',
      data: { ...LOCAL, id: '019a6f00-0000-7000-8000-000000000011', name: 'Personal OS', fullName: 'MaximeD1412/personal-os', folder: null, connectors: ['github'] },
    },
  ],
});
