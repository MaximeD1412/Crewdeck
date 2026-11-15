import { z } from 'zod';
import { withSeq } from './commands.js';
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
 * A Projet (US-3): a Dépôt GitHub the Pilote follows, prepared for the
 * Process. Its name and branches come from the `.process.json` of its default
 * branch when it has one. `accessLost` once the App can no longer reach its
 * repository (removed from the installation, the installation deleted). The
 * payload of `project.upserted`, an item of `GET /api/projects` and of the
 * `projects` slice of `GET /api/state`.
 */
export const zProject = z.object({
  id: zId,
  repositoryId: zId,
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  displayName: z.string().min(1),
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

/** `POST /api/projects` (session): the Dépôts GitHub to follow, each becoming a Projet. */
export const zFollowProjects = withSeq(z.object({ repositoryIds: z.array(zId).min(1).max(FOLLOW_PROJECTS_MAX) }));
export type FollowProjects = z.infer<typeof zFollowProjects>;

/** Where `GET /api/github/setup` sends the Pilote back from GitHub's installation page: its `state`. */
export const INSTALL_RETURNS = ['demarrage', 'projets'] as const;
export const zInstallReturn = z.enum(INSTALL_RETURNS);
export type InstallReturn = z.infer<typeof zInstallReturn>;
