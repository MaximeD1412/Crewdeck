import { type SourceMigration, type SourceMigrationWaitingItem, zSourceMigrationWaitingItem } from '@crewdeck/contracts';
import { z } from 'zod';
import type { SourceGroup, SourceKind, SourceMigrationState } from '../../../generated/prisma/client.js';

/** What of a `source_migrations` row the page sees: `GET /api/projects/:id/source-migrations`, the `sourceMigrations` slice, `source-migration.upserted`. */
export const SOURCE_MIGRATION_VIEW = {
  id: true,
  projectId: true,
  group: true,
  from: true,
  to: true,
  state: true,
  total: true,
  copied: true,
  waitingItems: true,
  errorCode: true,
  attempt: true,
  createdAt: true,
  switchedAt: true,
  endedAt: true,
} as const;

export interface SourceMigrationRow {
  readonly id: string;
  readonly projectId: string;
  readonly group: SourceGroup;
  readonly from: SourceKind;
  readonly to: SourceKind;
  readonly state: SourceMigrationState;
  readonly total: number;
  readonly copied: number;
  readonly waitingItems: unknown;
  readonly errorCode: string | null;
  readonly attempt: number;
  readonly createdAt: Date;
  readonly switchedAt: Date | null;
  readonly endedAt: Date | null;
}

const zWaitingItems = z.array(zSourceMigrationWaitingItem);

/** The jsonb `waiting_items` as the contracts spell it; a row the server wrote, so a parse that fails is its bug. */
export const waitingItemsOf = (value: unknown): SourceMigrationWaitingItem[] => zWaitingItems.parse(value);

export const toSourceMigration = (row: SourceMigrationRow): SourceMigration => ({
  ...row,
  waitingItems: waitingItemsOf(row.waitingItems),
  createdAt: row.createdAt.toISOString(),
  switchedAt: row.switchedAt?.toISOString() ?? null,
  endedAt: row.endedAt?.toISOString() ?? null,
});
