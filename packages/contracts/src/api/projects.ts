import { z } from 'zod';
import { zVaultKeyVersion } from '../keys/pairing.js';
import { zSealedItem } from '../keys/sealed.js';
import { withSeq } from './commands.js';
import { zBuiltinTemplateId } from './phase-runs.js';
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
 * The checks of a Projet's readiness (US-4, PROJET-3), in the order the page
 * lists them: the Runner linked, the Local folder, a usable Moteur per Rôle
 * the Étapes name, their Outils (Serveurs MCP, the Connecteur), the Process
 * (its active version, or the draft's Manques), the labels and the branches
 * on GitHub (by the Sources of the groups), the approved Inventaire.
 */
export const READINESS_CHECK_IDS = ['runner-linked', 'folder', 'engines', 'tools', 'process', 'labels', 'branches', 'inventory'] as const;
export const zReadinessCheckId = z.enum(READINESS_CHECK_IDS);
export type ReadinessCheckId = z.infer<typeof zReadinessCheckId>;

/** The checks « Corriger » fixes on one click (`POST /api/projects/:id/fixes/:checkId`). */
export const READINESS_AUTO_FIXES = ['labels', 'branches', 'folder'] as const satisfies readonly ReadinessCheckId[];
export const zReadinessFixId = z.enum(READINESS_AUTO_FIXES);
export type ReadinessFixId = z.infer<typeof zReadinessFixId>;

export const READINESS_CHECK_STATES = ['ok', 'missing', 'pending'] as const;
export type ReadinessCheckState = (typeof READINESS_CHECK_STATES)[number];

/**
 * One check: its state, the figures its row shows (`facts`: names, counts,
 * flags, never a free text of the Pilote), and its fix: `auto` the product
 * makes it on one click, `link` the page leads where it is made, `null`
 * nothing to do here.
 */
export const zReadinessCheck = z.object({
  id: zReadinessCheckId,
  state: z.enum(READINESS_CHECK_STATES),
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  fix: z.enum(['auto', 'link']).nullable(),
});
export type ReadinessCheck = z.infer<typeof zReadinessCheck>;

/** What a Projet still misses to run its Process: the checks that apply, `ready` once every one is `ok`. Stored, computed on its triggers only. */
export const zReadiness = z.object({ ready: z.boolean(), computedAt: zInstant, checks: z.array(zReadinessCheck) });
export type Readiness = z.infer<typeof zReadiness>;

/** `POST /api/projects/:id/fixes/:checkId` (session): fix the check, against the Projet's `seq`. */
export const zFixReadiness = withSeq(z.object({}));
export type FixReadiness = z.infer<typeof zFixReadiness>;

/**
 * A Projet (US-3): a Dépôt GitHub the Pilote follows, or a folder of the
 * Runner's machine (a Local Projet, PROJET-6: no repository, its name sealed
 * under the vault key in `nameSealed`, `project:<id>:name`, its folder's path
 * on the Runner only, `folder` where it stands), prepared for the
 * Process. A GitHub Projet's name is its repository's; its integration branch is `develop`
 * and its release branch the repository's default branch until the Pilote
 * changes them in its Paramètres (ADR 0011). `accessLost` once the App can no longer reach its
 * repository (removed from the installation, the installation deleted).
 * `readiness` what it still misses to run its Process (PROJET-3), `null`
 * until first computed. The
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
  readiness: zReadiness.nullable(),
  followedAt: zInstant,
});
export type Project = z.infer<typeof zProject>;

/** `GET /api/projects` (session), and the answer of `POST /api/projects`: the Projets, by name. */
export const zProjectList = z.object({ items: z.array(zProject) });
export type ProjectList = z.infer<typeof zProjectList>;

/** The Modèle de process a new Projet starts from (US-97): « Process Crewdeck » only, until the Pilote's own (PROCESS-14). */
export const zProcessTemplateId = zBuiltinTemplateId;
export type ProcessTemplateId = z.infer<typeof zProcessTemplateId>;

/** `POST /api/projects` (session): the Dépôts GitHub to follow, each becoming a Projet started from `templateId`. */
export const zFollowProjects = withSeq(z.object({ repositoryIds: z.array(zId).min(1).max(FOLLOW_PROJECTS_MAX), templateId: zProcessTemplateId }));
export type FollowProjects = z.infer<typeof zFollowProjects>;

/**
 * `POST /api/projects/local` (session): a Projet from a folder the Runner
 * checked (PROJET-6). `id` is drawn by the page (a UUIDv7), so that the name
 * is sealed for it (`project:<id>:name`) and the path for the Runner
 * (`project:<id>:folder`) before the server sees them; `hasCode` and
 * `releaseBranch` (the folder's branch, `null` without git) are the check's.
 * `vaultKeyVersion` is the version of the vault key both were sealed under:
 * 409 `vault.version-changed` once another holder rotated it.
 */
export const zCreateLocalProject = z.object({
  id: zId,
  nameSealed: zSealedItem,
  folderSealed: zSealedItem,
  vaultKeyVersion: zVaultKeyVersion,
  hasCode: z.boolean(),
  releaseBranch: z.string().min(1).max(255).nullable(),
  templateId: zProcessTemplateId,
});
export type CreateLocalProject = z.infer<typeof zCreateLocalProject>;

/** `POST /api/projects/:id/folder` (session): choose a Local Projet's folder again, sealed for the Runner under `vaultKeyVersion`. */
export const zAttachProjectFolder = withSeq(z.object({ folderSealed: zSealedItem, vaultKeyVersion: zVaultKeyVersion }));
export type AttachProjectFolder = z.infer<typeof zAttachProjectFolder>;

/** Where `GET /api/github/setup` sends the Pilote back from GitHub's installation page: its `state`. */
export const INSTALL_RETURNS = ['demarrage', 'projets'] as const;
export const zInstallReturn = z.enum(INSTALL_RETURNS);
export type InstallReturn = z.infer<typeof zInstallReturn>;
