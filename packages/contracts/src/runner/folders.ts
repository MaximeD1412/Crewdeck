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

/**
 * The readiness of a Local Projet's folder (PROJET-3): the server asks where
 * the folder stands, and asks the Runner to prepare it (« git init », a first
 * commit with the Pilote's own git identity, the integration branch), never
 * on top of the Pilote's work. Figures only, never the path.
 *
 * - server → Runner: `project.folder.status`, `project.folder.prepare`;
 * - Runner → server: `project.folder.state` (after each status and each prepare), `project.folder.prepared`.
 */

/** Server → Runner: say where the Projet's folder stands (`project.folder.state`). */
export const zProjectFolderStatus = runnerMessage('project.folder.status', { projectId: zId });
export type ProjectFolderStatus = z.infer<typeof zProjectFolderStatus>;

const zBranchName = z.string().min(1).max(255);

/** Server → Runner: prepare the Projet's folder, from its release and its integration branches; answered by `project.folder.prepared` for `requestId`. */
export const zProjectFolderPrepare = runnerMessage('project.folder.prepare', { requestId: zId, projectId: zId, releaseBranch: zBranchName, integrationBranch: zBranchName });
export type ProjectFolderPrepare = z.infer<typeof zProjectFolderPrepare>;

/**
 * Runner → server: where the Projet's folder stands. `present` false when the
 * Runner has no folder for it or the folder is gone (every other figure then
 * false); `isGit` a git repository, `hasCommits` at least one commit, each
 * branch whether it exists locally.
 */
export const zProjectFolderStateMessage = runnerMessage('project.folder.state', {
  projectId: zId,
  present: z.boolean(),
  isGit: z.boolean(),
  hasCommits: z.boolean(),
  releaseBranch: z.boolean(),
  integrationBranch: z.boolean(),
});
export type ProjectFolderStateMessage = z.infer<typeof zProjectFolderStateMessage>;

/** Why a folder's preparation failed: the folder gone, no git identity for the first commit (nothing committed), git refused. */
export const PROJECT_FOLDER_PREPARE_ERRORS = ['folder-missing', 'git-identity-missing', 'git-failed'] as const;
export const zProjectFolderPrepareError = z.enum(PROJECT_FOLDER_PREPARE_ERRORS);
export type ProjectFolderPrepareError = z.infer<typeof zProjectFolderPrepareError>;

/** Runner → server: the preparation `requestId` ended, `ok` or with its `error`. */
export const zProjectFolderPrepared = runnerMessage('project.folder.prepared', { requestId: zId, projectId: zId, ok: z.boolean(), error: zProjectFolderPrepareError.optional() });
export type ProjectFolderPrepared = z.infer<typeof zProjectFolderPrepared>;
