import { z } from 'zod';
import { FOLDER_CHECK_STATES, FOLDER_PATH_MAX, PROJECT_NAME_MAX } from '../keys/folder.js';
import { defineComposant } from './define.js';

/**
 * Where the check of the typed path stands: `idle` before any, `checking`
 * while the Runner answers, one of the Runner's states, `runner-offline` when
 * the server could not reach it, `timeout` when it did not answer in time.
 */
export const FOLDER_FORM_CHECK_STATES = ['idle', 'checking', ...FOLDER_CHECK_STATES, 'runner-offline', 'timeout'] as const;
export const zFolderFormCheckState = z.enum(FOLDER_FORM_CHECK_STATES);
export type FolderFormCheckState = z.infer<typeof zFolderFormCheckState>;

/** Where the form shows: on `/projets/ajouter`, in « Premiers pas », or to choose a Projet's folder again (`repick`). */
export const FOLDER_FORM_CONTEXTS = ['demarrage', 'projets', 'repick'] as const;

/** The Modèles de process of the examples: « Process Crewdeck » only, until PROCESS-14. */
export const EXAMPLE_TEMPLATES = [{ id: 'process-crewdeck', label: 'Process Crewdeck' }] as const;

const folderProjectFormData = z.object({
  context: z.enum(FOLDER_FORM_CONTEXTS),
  path: z.string().max(FOLDER_PATH_MAX),
  check: z.object({ state: zFolderFormCheckState, hasCode: z.boolean() }),
  name: z.string().max(PROJECT_NAME_MAX),
  templates: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })),
  templateId: z.string(),
  busy: z.boolean(),
  vaultLocked: z.boolean(),
  machine: z.string().nullable(),
});

const EXAMPLE: z.input<typeof folderProjectFormData> = {
  context: 'projets',
  path: '~/projets/recettes',
  check: { state: 'ready', hasCode: true },
  name: 'recettes',
  templates: [...EXAMPLE_TEMPLATES],
  templateId: 'process-crewdeck',
  busy: false,
  vaultLocked: false,
  machine: 'atelier-pc',
};

/**
 * A Projet from a folder of the Runner's machine (US-3, US-99, PROJET-6): a
 * TextField « Chemin du dossier » whose help (or error) is the check's line,
 * each keystroke emitting `checkPath` (the page debounces it and asks the
 * Runner); a TextField « Nom du Projet », filled with the folder's name until
 * the Pilote types one; a Select « Modèle de process »; « Créer le Projet »
 * (`create`), enabled on `ready` or `not-git` with a name and the vault open.
 * In « Premiers pas », « Plus tard » (`later`). `repick`: the path only, and
 * « Relier ce dossier » (`create`, with the Projet's name). `machine` is the
 * Runner's, for « Dossier introuvable sur <machine>. ». `busy` while the
 * command is on its way; `vaultLocked` on an Appareil without the vault key.
 */
export const FolderProjectForm = defineComposant({
  name: 'FolderProjectForm',
  version: 1,
  tag: 'cd-folder-project-form',
  category: 'partie',
  description: 'Un Projet depuis un dossier de la machine du Runner : son chemin vérifié, son nom, son Modèle de process.',
  data: folderProjectFormData,
  actions: {
    checkPath: z.object({ path: z.string().max(FOLDER_PATH_MAX) }),
    create: z.object({ path: z.string().min(1).max(FOLDER_PATH_MAX), name: z.string().trim().min(1).max(PROJECT_NAME_MAX), templateId: z.string().min(1) }),
    later: z.object({}),
  },
  slots: [],
  examples: [
    { name: 'dépôt git avec du code', data: EXAMPLE },
    { name: 'vide', data: { ...EXAMPLE, path: '', check: { state: 'idle', hasCode: false }, name: '' } },
    { name: 'pas encore un dépôt git', data: { ...EXAMPLE, check: { state: 'not-git', hasCode: true } } },
    { name: 'dossier introuvable', data: { ...EXAMPLE, path: '~/projets/recetes', check: { state: 'missing', hasCode: false }, name: 'recetes' } },
    { name: 'Runner hors ligne', data: { ...EXAMPLE, check: { state: 'runner-offline', hasCode: false } } },
    { name: 'coffre verrouillé', data: { ...EXAMPLE, vaultLocked: true } },
    { name: 'choisir à nouveau', data: { ...EXAMPLE, context: 'repick', name: 'Recettes' } },
  ],
});
