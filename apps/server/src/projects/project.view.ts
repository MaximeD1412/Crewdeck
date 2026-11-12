import type { InventoryState, Project } from '@crewdeck/contracts';
import type { InventoryState as InventoryStateRow } from '../generated/prisma/client.js';

/** What of a `projects` row the page sees: `GET /api/projects`, the `projects` slice, `project.upserted`. */
export const PROJECT_VIEW = {
  id: true,
  repositoryId: true,
  owner: true,
  name: true,
  fullName: true,
  displayName: true,
  releaseBranch: true,
  integrationBranch: true,
  hasCode: true,
  inventoryState: true,
  accessLost: true,
  followedAt: true,
} as const;

interface ProjectRow {
  readonly id: string;
  readonly repositoryId: string;
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly displayName: string;
  readonly releaseBranch: string;
  readonly integrationBranch: string;
  readonly hasCode: boolean;
  readonly inventoryState: InventoryStateRow;
  readonly accessLost: boolean;
  readonly followedAt: Date;
}

/** The state as the contracts spell it (`not-needed`), Prisma's enum keeping `not_needed`. */
export const inventoryStateOf = (row: InventoryStateRow): InventoryState => row.replaceAll('_', '-') as InventoryState;
export const inventoryStateRow = (state: InventoryState): InventoryStateRow => state.replaceAll('-', '_') as InventoryStateRow;

export const toProject = (row: ProjectRow): Project => ({
  ...row,
  inventoryState: inventoryStateOf(row.inventoryState),
  followedAt: row.followedAt.toISOString(),
});
