import { z } from 'zod';
import { PROCESS_TEMPLATE_NAME_MAX } from '../api/process-templates.js';
import { zId } from '../values.js';
import { defineComposant } from './define.js';

/** How long a Modèle's name is, for a Skin to say it (it imports no `api/`). */
export { PROCESS_TEMPLATE_NAME_MAX };

const MAIRIE = { id: '01936f4e-8a2b-7c3d-9e4f-5a6b7c8d9e0f', name: 'Process Site mairie', meta: 'depuis Site mairie · 12 nov.' } as const;
const ATELIER = { id: '01936f4e-8a2b-7c3d-9e4f-5a6b7c8d9e10', name: 'Process atelier', meta: 'depuis un Projet supprimé · 3 nov.' } as const;

/**
 * The card « Modèles de process » of the Paramètres (PROCESS-14, US-111):
 * the Pilote's Modèles, newest first, each by its name and its `meta` (the
 * Projet it was saved from and its date, written by the page), with
 * « Renommer » (`rename`) and « Supprimer » (`remove`); none, its Empty.
 * `renaming` opens the Dialog « Renommer le Modèle de process »: its name,
 * the server's `error` under it, « Annuler » (`cancel`) and « Renommer »
 * (`submitRename`, Enter in the field too). `removing` opens the Dialog that
 * asks before `confirmRemove`. « Process Crewdeck » is never one of them.
 */
export const ProcessTemplateList = defineComposant({
  name: 'ProcessTemplateList',
  version: 1,
  tag: 'cd-process-template-list',
  category: 'partie',
  description: 'Les Modèles de process du Pilote : chacun renommé ou supprimé.',
  data: z.object({
    templates: z.array(z.object({ id: zId, name: z.string().min(1), meta: z.string() })),
    renaming: z.object({ id: zId, name: z.string(), error: z.string().nullable() }).nullable(),
    removing: z.object({ id: zId, name: z.string().min(1) }).nullable(),
  }),
  actions: {
    rename: z.object({ id: zId }),
    submitRename: z.object({ id: zId, name: z.string() }),
    remove: z.object({ id: zId }),
    confirmRemove: z.object({ id: zId }),
    cancel: z.object({}),
  },
  slots: [],
  examples: [
    { name: 'tes Modèles', data: { templates: [MAIRIE, ATELIER], renaming: null, removing: null } },
    { name: 'aucun Modèle', data: { templates: [], renaming: null, removing: null } },
    {
      name: 'renommer, un nom déjà pris',
      data: { templates: [MAIRIE, ATELIER], renaming: { id: MAIRIE.id, name: 'Process atelier', error: 'Un Modèle de process porte déjà ce nom.' }, removing: null },
    },
    { name: 'supprimer', data: { templates: [MAIRIE, ATELIER], renaming: null, removing: { id: ATELIER.id, name: ATELIER.name } } },
  ],
});
