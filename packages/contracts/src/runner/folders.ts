import { z } from 'zod';
import { zSealedItem } from '../keys/sealed.js';
import { zId } from '../values.js';
import { runnerMessage } from './envelope.js';

/**
 * The folders of Local Projets (PROJET-6, ADR 0012): the path is typed in a
 * tab, sealed under the vault key (`keys/folder.ts`), and checked by the
 * Runner through the server, which forwards it to the tab that asked and keeps
 * nothing; it reads only the ids. The Runner keeps each Projet's path in its
 * state and tells the server which folders are still there, by ids only.
 *
 * - tab → server: `folder.check`;
 * - server → Runner: `folder.check` (with the tab's `tabId`), `project.folder.attach`;
 * - Runner → server: `folder.checked` (with the `tabId`), `projects.folders`;
 * - server → tab: `folder.checked`, `folder.error`.
 */

const checkShape = { requestId: zId, sealed: zSealedItem };

/** Server → Runner: check the path sealed by the tab `tabId` (`folder.check:<requestId>`). */
export const zFolderCheckMessage = runnerMessage('folder.check', { ...checkShape, tabId: zId });
export type FolderCheckMessage = z.infer<typeof zFolderCheckMessage>;

/** Server → Runner: keep this folder as the Projet's (`project:<projectId>:folder`), once checked again. */
export const zProjectFolderAttach = runnerMessage('project.folder.attach', { projectId: zId, sealed: zSealedItem });
export type ProjectFolderAttach = z.infer<typeof zProjectFolderAttach>;

/** Runner → server: the check of `requestId`, sealed (`folder.checked:<requestId>`), for the tab `tabId` only. */
export const zFolderChecked = runnerMessage('folder.checked', { ...checkShape, tabId: zId });
export type FolderChecked = z.infer<typeof zFolderChecked>;

/** At most this many Projets in one `projects.folders`. */
export const PROJECTS_FOLDERS_MAX = 1000;

/** Runner → server: the Projets whose folder is still on the machine; every other Local Projet's is missing. */
export const zProjectsFolders = runnerMessage('projects.folders', { present: z.array(zId).max(PROJECTS_FOLDERS_MAX) });
export type ProjectsFolders = z.infer<typeof zProjectsFolders>;

/** Tab → server: check this path, sealed in the tab; `requestId` a UUIDv7 the tab draws. */
export const zTabFolderCheck = z.object({ type: z.literal('folder.check'), ...checkShape });
/** Server → tab: the Runner's check of `requestId`. */
export const zTabFolderChecked = z.object({ type: z.literal('folder.checked'), ...checkShape });

/** Why the server could not forward a check: the Runner is offline. */
export const FOLDER_RELAY_ERRORS = ['runner.offline'] as const;
export const zFolderRelayError = z.enum(FOLDER_RELAY_ERRORS);
export type FolderRelayError = z.infer<typeof zFolderRelayError>;

/** Server → tab: the check of `requestId` could not reach the Runner. */
export const zTabFolderError = z.object({ type: z.literal('folder.error'), requestId: zId, code: zFolderRelayError });

export const zTabFolderClientMessage = zTabFolderCheck;
export type TabFolderClientMessage = z.infer<typeof zTabFolderCheck>;
export const zTabFolderServerMessage = z.discriminatedUnion('type', [zTabFolderChecked, zTabFolderError]);
export type TabFolderServerMessage = z.infer<typeof zTabFolderServerMessage>;
