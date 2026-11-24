import { z } from 'zod';
import { zVaultKeyVersion } from '../keys/pairing.js';
import { zSealedItem } from '../keys/sealed.js';
import { withSeq } from './commands.js';
import { zBuiltinTemplateId } from './phase-runs.js';
import { zProcessTemplateRevision } from './process-templates.js';
import { zId, zInstant } from '../values.js';

/**
 * Where a Projet's Inventaire stands (PROJET-4, PROJET-5): `not-needed` for a
 * Dépôt GitHub followed empty, `pending` for one followed with code, then
 * drafted, to approve, its PR to merge, approved.
 */
export const INVENTORY_STATES = ['not-needed', 'pending', 'drafting', 'to-approve', 'awaiting-merge', 'approved'] as const;
export const zInventoryState = z.enum(INVENTORY_STATES);
export type InventoryState = z.infer<typeof zInventoryState>;

/** At most this many Dépôts GitHub per Pilote are listed (the `repositories` slice is bounded, ADR 0008); more is past the MVP. */
export const REPOSITORIES_MAX = 500;

/** At most this many Dépôts GitHub followed by one `POST /api/projects`. */
export const FOLLOW_PROJECTS_MAX = 20;

/**
 * A Dépôt GitHub (US-3): a repository the Pilote's installation of the App
 * can reach, from GitHub's metadata only (ADR 0002). `hasCode` once its
 * default branch has two commits or more (the first one is GitHub's README);
 * `followed` once it is a Projet. The payload of `repository.upserted`, an
 * item of the `repositories` slice of `GET /api/state` (those not followed).
 */
export const zRepository = z.object({
  id: zId,
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  private: z.boolean(),
  defaultBranch: z.string().min(1),
  hasCode: z.boolean(),
  followed: z.boolean(),
});
export type Repository = z.infer<typeof zRepository>;

/**
 * Where a Local Projet's folder stands (PROJET-6): `pending` until the Runner
 * kept it, `present` while the Runner lists it, `missing` once it does not
 * (the folder gone, another Runner linked).
 */
export const PROJECT_FOLDER_STATES = ['pending', 'present', 'missing'] as const;
export const zProjectFolderState = z.enum(PROJECT_FOLDER_STATES);
export type ProjectFolderState = z.infer<typeof zProjectFolderState>;

/**
 * A Projet (US-3): a Dépôt GitHub the Pilote follows, or a folder of the
 * Runner's machine (a Local Projet, PROJET-6: no repository, its name sealed
 * under the vault key in `nameSealed`, `project:<id>:name`, its folder's path
 * on the Runner only, `folder` where it stands), prepared for the
 * Process. A GitHub Projet's name is its repository's; its integration branch is `develop`
 * and its release branch the repository's default branch until the Pilote
 * changes them in its Paramètres (ADR 0011). `accessLost` once the App can no longer reach its
 * repository (removed from the installation, the installation deleted). The
 * payload of `project.upserted`, an item of `GET /api/projects` and of the
 * `projects` slice of `GET /api/state`.
 */
export const zProject = z.object({
  id: zId,
  repositoryId: zId.nullable(),
  owner: z.string().min(1).nullable(),
  name: z.string().min(1).nullable(),
  fullName: z.string().min(1).nullable(),
  displayName: z.string().min(1).nullable(),
  nameSealed: zSealedItem.nullable(),
  folder: zProjectFolderState.nullable(),
  releaseBranch: z.string().min(1),
  integrationBranch: z.string().min(1),
  hasCode: z.boolean(),
  inventoryState: zInventoryState,
  accessLost: z.boolean(),
  followedAt: zInstant,
});
export type Project = z.infer<typeof zProject>;

/** `GET /api/projects` (session), and the answer of `POST /api/projects`: the Projets, by name. */
export const zProjectList = z.object({ items: z.array(zProject) });
export type ProjectList = z.infer<typeof zProjectList>;

/**
 * The Modèle de process a new Projet starts from (US-97): « Process Crewdeck »,
 * data of the release, or one of the Pilote's own Modèles by its id
 * (PROCESS-14).
 */
export const zProcessTemplateId = z.union([zBuiltinTemplateId, zId]);
export type ProcessTemplateId = z.infer<typeof zProcessTemplateId>;

/** Whether `templateId` names one of the Pilote's own Modèles (an id), rather than a Modèle of the release; `false` for anything else. */
export const isOwnProcessTemplate = (templateId: unknown): boolean => zId.safeParse(templateId).success;

/**
 * A Dépôt GitHub to follow as the Projet `id`, drawn by the page (a UUIDv7):
 * the Modèle's sealed part re-sealed under `process:<id>` (`templateSealed`,
 * `null` for a Modèle without Commande).
 */
export const zFollowedProject = z.object({ repositoryId: zId, id: zId, templateSealed: zSealedItem.nullable() });
export type FollowedProject = z.infer<typeof zFollowedProject>;

/**
 * `POST /api/projects` (session): the Dépôts GitHub to follow, each becoming a
 * Projet started from `templateId`. `projects` gives each one's id and
 * re-sealed part: required, one per repository, with an own Modèle; optional
 * with « Process Crewdeck », whose Projets the server names otherwise. With an
 * own Modèle, `templateRevision` is the revision of the Modèle the page sealed
 * again (409 `process-template.changed` once it is replaced), and
 * `vaultKeyVersion` the version of the vault key its parts were sealed under
 * (409 `vault.version-changed`), required with a part.
 */
export const zFollowProjects = withSeq(
  z.object({
    repositoryIds: z.array(zId).min(1).max(FOLLOW_PROJECTS_MAX),
    templateId: zProcessTemplateId,
    templateRevision: zProcessTemplateRevision.optional(),
    projects: z.array(zFollowedProject).max(FOLLOW_PROJECTS_MAX).optional(),
    vaultKeyVersion: zVaultKeyVersion.optional(),
  }),
).superRefine((input, ctx) => {
  if (isOwnProcessTemplate(input.templateId) && input.templateRevision === undefined) {
    ctx.addIssue({ code: 'custom', path: ['templateRevision'], message: 'Un Projet parti de ton Modèle de process dit quelle révision de lui il copie.' });
  }
  if (input.projects?.some((project) => project.templateSealed !== null) && input.vaultKeyVersion === undefined) {
    ctx.addIssue({ code: 'custom', path: ['vaultKeyVersion'], message: 'Une partie chiffrée vient avec la version de la clé sous laquelle elle l’a été.' });
  }
  if (input.projects === undefined) {
    if (isOwnProcessTemplate(input.templateId)) ctx.addIssue({ code: 'custom', path: ['projects'], message: 'Un Projet parti de ton Modèle de process a besoin de son identifiant.' });
    return;
  }
  const given = input.projects.map((project) => project.repositoryId).sort();
  const wanted = [...new Set(input.repositoryIds)].sort();
  const ids = new Set(input.projects.map((project) => project.id));
  if (given.length !== wanted.length || given.some((id, index) => id !== wanted[index]) || ids.size !== input.projects.length) {
    ctx.addIssue({ code: 'custom', path: ['projects'], message: 'Chaque dépôt suivi a un identifiant de Projet, et un seul.' });
  }
});
export type FollowProjects = z.infer<typeof zFollowProjects>;

/**
 * `POST /api/projects/local` (session): a Projet from a folder the Runner
 * checked (PROJET-6). `id` is drawn by the page (a UUIDv7), so that the name
 * is sealed for it (`project:<id>:name`) and the path for the Runner
 * (`project:<id>:folder`) before the server sees them; `hasCode` and
 * `releaseBranch` (the folder's branch, `null` without git) are the check's.
 * `vaultKeyVersion` is the version of the vault key both were sealed under:
 * 409 `vault.version-changed` once another holder rotated it. `templateSealed`
 * is an own Modèle's sealed part re-sealed under `process:<id>` (PROCESS-14),
 * `null` for a Modèle without Commande, under the same version; with an own
 * Modèle, `templateRevision` is the revision the page sealed again (409
 * `process-template.changed` once it is replaced).
 */
export const zCreateLocalProject = z.object({
  id: zId,
  nameSealed: zSealedItem,
  folderSealed: zSealedItem,
  vaultKeyVersion: zVaultKeyVersion,
  hasCode: z.boolean(),
  releaseBranch: z.string().min(1).max(255).nullable(),
  templateId: zProcessTemplateId,
  templateRevision: zProcessTemplateRevision.optional(),
  templateSealed: zSealedItem.nullable(),
}).refine((input) => !isOwnProcessTemplate(input.templateId) || input.templateRevision !== undefined, {
  path: ['templateRevision'],
  message: 'Un Projet parti de ton Modèle de process dit quelle révision de lui il copie.',
});
export type CreateLocalProject = z.infer<typeof zCreateLocalProject>;

/** `POST /api/projects/:id/folder` (session): choose a Local Projet's folder again, sealed for the Runner under `vaultKeyVersion`. */
export const zAttachProjectFolder = withSeq(z.object({ folderSealed: zSealedItem, vaultKeyVersion: zVaultKeyVersion }));
export type AttachProjectFolder = z.infer<typeof zAttachProjectFolder>;

/** Where `GET /api/github/setup` sends the Pilote back from GitHub's installation page: its `state`. */
export const INSTALL_RETURNS = ['demarrage', 'projets'] as const;
export const zInstallReturn = z.enum(INSTALL_RETURNS);
export type InstallReturn = z.infer<typeof zInstallReturn>;
