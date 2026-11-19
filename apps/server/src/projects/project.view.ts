import { type InventoryState, type Project, zReadiness, zSealedItem } from '@crewdeck/contracts';
import type { InventoryState as InventoryStateRow, Prisma, ProjectFolderState } from '../generated/prisma/client.js';

/** What of a `projects` row the page sees: `GET /api/projects`, the `projects` slice, `project.upserted`. */
export const PROJECT_VIEW = {
  id: true,
  repositoryId: true,
  owner: true,
  name: true,
  fullName: true,
  displayName: true,
  nameSealed: true,
  folderState: true,
  releaseBranch: true,
  integrationBranch: true,
  hasCode: true,
  inventoryState: true,
  accessLost: true,
  readiness: true,
  followedAt: true,
} as const;

export interface ProjectRow {
  readonly id: string;
  readonly repositoryId: string | null;
  readonly owner: string | null;
  readonly name: string | null;
  readonly fullName: string | null;
  readonly displayName: string | null;
  readonly nameSealed: Prisma.JsonValue;
  readonly folderState: ProjectFolderState | null;
  readonly releaseBranch: string;
  readonly integrationBranch: string;
  readonly hasCode: boolean;
  readonly inventoryState: InventoryStateRow;
  readonly accessLost: boolean;
  readonly readiness: Prisma.JsonValue;
  readonly followedAt: Date;
}

/** The state as the contracts spell it (`not-needed`), Prisma's enum keeping `not_needed`. */
export const inventoryStateOf = (row: InventoryStateRow): InventoryState => row.replaceAll('_', '-') as InventoryState;
export const inventoryStateRow = (state: InventoryState): InventoryStateRow => state.replaceAll('-', '_') as InventoryStateRow;

/**
 * The names of a GitHub Projet's row; a Local Projet has none
 * (`projects_github_or_local`): reached only through a repository, so never
 * here.
 */
export const githubNamesOf = (row: { readonly owner: string | null; readonly name: string | null; readonly fullName?: string | null }): { owner: string; name: string; fullName: string } => {
  if (row.owner === null || row.name === null || row.fullName === null) throw new Error('not a GitHub Projet');
  return { owner: row.owner, name: row.name, fullName: row.fullName ?? `${row.owner}/${row.name}` };
};

export const toProject = ({ nameSealed, folderState, readiness, ...row }: ProjectRow): Project => ({
  ...row,
  nameSealed: nameSealed === null ? null : zSealedItem.parse(nameSealed),
  readiness: readiness === null ? null : zReadiness.parse(readiness),
  folder: folderState,
  inventoryState: inventoryStateOf(row.inventoryState),
  followedAt: row.followedAt.toISOString(),
});
