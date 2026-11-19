import { type SourceGroup, type SourceKind, type SourceMigration, zSourceMigration } from '@crewdeck/contracts';
import type { Client } from './client.js';

/**
 * `POST /api/projects/:id/sources/:group/migrate` (SOURCE-7, the Action
 * sensible `source.migrate`): the group's migration to `to`, `draining`,
 * whose events the store gets too. `seq` is the one the Pilote saw when the
 * dialog opened. A refusal is an `ApiError` (409 stale, 422 `source.same`,
 * `source.migration-running`, `source.target-missing`,
 * `source.runner-cannot-migrate`).
 */
export const migrateSource = (client: Pick<Client, 'command'>, projectId: string, group: SourceGroup, to: SourceKind, seq: bigint): Promise<SourceMigration> =>
  client.command('POST', `/api/projects/${encodeURIComponent(projectId)}/sources/${group}/migrate`, { to, seq }, zSourceMigration);

/** `POST /api/source-migrations/:id/retry`: « Réessayer » a `failed` migration, `draining` again with one more `attempt`. */
export const retrySourceMigration = (client: Pick<Client, 'command'>, migrationId: string): Promise<SourceMigration> =>
  client.command('POST', `/api/source-migrations/${encodeURIComponent(migrationId)}/retry`, {}, zSourceMigration);
