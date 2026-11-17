import { z } from 'zod';
import { zId } from '../values.js';

/**
 * The plaintexts of a Local Projet's folder (PROJET-6, ADR 0012, ADR 0003):
 * the path the Pilote types travels sealed under the vault key, to the Runner
 * only, which answers its check sealed the same way. Neither the server nor
 * the page keeps the path; the Runner keeps it in its state (`projects`).
 */

/** The longest path a Pilote may type. */
export const FOLDER_PATH_MAX = 4096;

/** The longest name of a Local Projet (sealed, `project:<id>:name`). */
export const PROJECT_NAME_MAX = 100;

/**
 * What the tab seals for `folder.check`, and the page for a folder to attach
 * (`project:<id>:folder`). `projectId`, on a check only: the Projet whose
 * folder is chosen again, whose own folder is then not `taken`.
 */
export const zFolderCheck = z.strictObject({ path: z.string().min(1).max(FOLDER_PATH_MAX), projectId: zId.optional() });
export type FolderCheck = z.infer<typeof zFolderCheck>;

/**
 * Where a typed path stands, on the Runner's machine: `not-absolute` (neither
 * `/` nor `~`), `missing`, `not-a-folder` (or inside the Runner's own state),
 * `taken` (another Projet's folder), `not-git` (a folder, not a git
 * repository's root), `ready` (a git repository's root).
 */
export const FOLDER_CHECK_STATES = ['not-absolute', 'missing', 'not-a-folder', 'taken', 'not-git', 'ready'] as const;
export const zFolderCheckState = z.enum(FOLDER_CHECK_STATES);
export type FolderCheckState = z.infer<typeof zFolderCheckState>;

/** The Runner's answer, sealed for `folder.checked`: `branch` the folder's current branch (`null` without git), `name` its base name. */
export const zFolderCheckResult = z.strictObject({
  state: zFolderCheckState,
  hasCode: z.boolean(),
  branch: z.string().min(1).nullable(),
  name: z.string(),
});
export type FolderCheckResult = z.infer<typeof zFolderCheckResult>;

/** The additional data of a tab's `folder.check`. */
export const folderCheckAad = (requestId: string): string => `folder.check:${requestId}`;
/** The additional data of the Runner's `folder.checked`. */
export const folderCheckedAad = (requestId: string): string => `folder.checked:${requestId}`;
/** The additional data of a Projet's folder, sealed for `project.folder.attach`. */
export const projectFolderAad = (projectId: string): string => `project:${projectId}:folder`;
/** The additional data of a Local Projet's name (`nameSealed`). */
export const projectNameAad = (projectId: string): string => `project:${projectId}:name`;
