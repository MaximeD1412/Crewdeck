import {
  type PickSourceFolderInput,
  type SourceGroup,
  type SourceKind,
  type SourceMigration,
  type SourceMigrationTarget,
  zSourceMigration,
} from '@crewdeck/contracts';
import type { Client } from './client.js';

const sourcesPath = (projectId: string, group: SourceGroup) => `/api/projects/${encodeURIComponent(projectId)}/sources/${group}`;

/**
 * `POST /api/projects/:id/sources/:group/migrate` (SOURCE-7, the Action
 * sensible `source.migrate`): the group's migration to `to`, `draining`,
 * whose events the store gets too. `seq` is the one the Pilote saw when the
 * dialog opened; `target` the new place picked when the Projet has none on
 * `to` (SOURCE-9). A refusal is an `ApiError` (409 stale, 422 `source.same`,
 * `source.migration-running`, `source.target-missing`,
 * `source.runner-cannot-migrate`, `source.repository-followed`,
 * `source.repository-not-empty`, `source.folder-not-picked`).
 */
export const migrateSource = (
  client: Pick<Client, 'command'>,
  projectId: string,
  group: SourceGroup,
  to: SourceKind,
  seq: bigint,
  target?: SourceMigrationTarget,
): Promise<SourceMigration> => client.command('POST', `${sourcesPath(projectId, group)}/migrate`, { to, seq, ...(target === undefined ? {} : { target }) }, zSourceMigration);

/**
 * `POST /api/projects/:id/sources/:group/folder` (SOURCE-9): the folder a
 * migration of `group` to Local will use, sealed for the Runner, which checks
 * it again and holds it until the switch. A refusal is an `ApiError` (404
 * `project.not-found`, 422 `runner.offline`, 409 `vault.version-changed`).
 */
export const postSourceFolder = (client: Pick<Client, 'command'>, projectId: string, group: SourceGroup, body: PickSourceFolderInput): Promise<void> =>
  client.command('POST', `${sourcesPath(projectId, group)}/folder`, body);

/** `POST /api/source-migrations/:id/retry`: « Réessayer » a `failed` migration, `draining` again with one more `attempt`. */
export const retrySourceMigration = (client: Pick<Client, 'command'>, migrationId: string): Promise<SourceMigration> =>
  client.command('POST', `/api/source-migrations/${encodeURIComponent(migrationId)}/retry`, {}, zSourceMigration);
