import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';

/** The Projet chips under a page's title: `select` with `projectId: null` for « Tous les Projets ». */
export const ProjectFilter = defineComposant({
  name: 'ProjectFilter',
  version: 1,
  tag: 'cd-project-filter',
  category: 'cadre',
  description: 'Les puces des Projets sous le titre d’une page.',
  data: z.object({
    chips: z.array(
      z.object({
        projectId: zId.nullable(),
        label: z.string(),
        count: z.number().int().nonnegative().optional(),
        selected: z.boolean(),
      }),
    ),
  }),
  actions: { select: z.object({ projectId: zId.nullable() }) },
  slots: [],
  examples: [
    {
      name: 'tous les Projets',
      data: {
        chips: [
          { projectId: null, label: 'Tous les Projets', count: 6, selected: true },
          { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a7b', label: 'Crewdeck', count: 4, selected: false },
          { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a7c', label: 'Personal OS', count: 2, selected: false },
        ],
      },
    },
  ],
});
