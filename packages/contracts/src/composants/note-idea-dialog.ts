import { z } from 'zod';
import { IDEA_TEXT_MAX } from '../api/ideas.js';
import { zId } from '../values.js';
import { defineComposant } from './define.js';
import { DICTATION_ACTIONS, DICTATION_EXAMPLES, zDictation } from './dictation.js';

const PROJECTS = [
  { id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01', name: 'Crewdeck' },
  { id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02', name: 'Personal OS' },
  { id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03', name: 'Site mairie' },
  { id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a04', name: 'Tennis Manager' },
];

/**
 * The Dialog « Noter une Idée » (US-5), the same from « Idées » and from
 * « À toi »: « Ton Idée, en une phrase », the Projet (« Laisser l’analyse
 * choisir », `projectId: null`, or one of `projects`, `defaultProjectId`
 * chosen at its opening), « Annuler » (`cancel`, Escape too) and « Noter »
 * (`submit`, Ctrl or ⌘ + Enter too) with the text as typed; the core seals
 * it, the Skin never does. Its fields are new at each opening; `busy` while
 * the Idée is on its way, `error` the core's refusal (an empty text, the
 * server's). `locked` when this Appareil cannot seal (not approved yet): the
 * Dialog says so and leads to `/parametres`, and has no field. `value` is
 * the text the core puts in the field, a dictation's transcript as it comes,
 * the Pilote correcting it once stopped; « Dicter » (`dictate-start`) and
 * « Arrêter la dictée » (`dictate-stop`) only where the browser can dictate.
 */
export const NoteIdeaDialog = defineComposant({
  name: 'NoteIdeaDialog',
  version: 2,
  tag: 'cd-note-idea-dialog',
  category: 'partie',
  description: 'Le dialogue « Noter une Idée » : une phrase et, au choix, son Projet.',
  data: z.object({
    open: z.boolean(),
    projects: z.array(z.object({ id: zId, name: z.string().min(1) })),
    defaultProjectId: zId.nullable(),
    busy: z.boolean(),
    error: z.string().min(1).nullable(),
    locked: z.boolean(),
    value: z.string(),
    dictation: zDictation,
  }),
  actions: {
    submit: z.object({ text: z.string().max(IDEA_TEXT_MAX), projectId: zId.nullable() }),
    cancel: z.object({}),
    ...DICTATION_ACTIONS,
  },
  slots: [],
  examples: [
    { name: 'ouvert', data: { open: true, projects: PROJECTS, defaultProjectId: null, busy: false, error: null, locked: false, value: '', dictation: DICTATION_EXAMPLES.idle } },
    {
      name: 'un Projet choisi, refusé',
      data: { open: true, projects: PROJECTS, defaultProjectId: PROJECTS[1]?.id ?? null, busy: false, error: 'Écris ton Idée avant de la noter.', locked: false, value: '', dictation: DICTATION_EXAMPLES.idle },
    },
    {
      name: 'dictée en cours',
      data: {
        open: true,
        projects: PROJECTS,
        defaultProjectId: null,
        busy: false,
        error: null,
        locked: false,
        value: 'Pouvoir dupliquer une recette pour en faire une variante, avec',
        dictation: DICTATION_EXAMPLES.dictating,
      },
    },
    {
      name: 'première dictée de l’Appareil',
      data: { open: true, projects: PROJECTS, defaultProjectId: null, busy: false, error: null, locked: false, value: 'Pouvoir dupliquer', dictation: DICTATION_EXAMPLES.firstTime },
    },
    {
      name: 'micro refusé',
      data: { open: true, projects: PROJECTS, defaultProjectId: null, busy: false, error: null, locked: false, value: '', dictation: DICTATION_EXAMPLES.refused },
    },
    {
      name: 'sans dictée',
      data: { open: true, projects: PROJECTS, defaultProjectId: null, busy: false, error: null, locked: false, value: '', dictation: DICTATION_EXAMPLES.missing },
    },
    {
      name: 'Appareil à approuver',
      data: { open: true, projects: PROJECTS, defaultProjectId: null, busy: false, error: null, locked: true, value: '', dictation: DICTATION_EXAMPLES.idle },
    },
  ],
});
