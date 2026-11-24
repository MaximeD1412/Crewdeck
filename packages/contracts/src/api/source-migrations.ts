import { z } from 'zod';
import { zSealedItem } from '../keys/sealed.js';
import { zVaultKeyVersion } from '../keys/pairing.js';
import { zArtifactType } from '../process/artifact-types.js';
import { zSourceGroup, zSourceKind } from '../process/sources.js';
import { zCursorPage, zCursorQuery, zId, zInstant } from '../values.js';
import { withSeq } from './commands.js';
import { zErrorCode } from './errors.js';
import type { InstallationPermissions } from '../github/index.js';

/**
 * The states of a migration of Source (ADR 0012, « Moving a Source »):
 * `draining` while the group's work in progress finishes on the old Source,
 * `copying` and `verifying` on the Runner, `switched` once the new Source
 * is the Source (the old place still to archive), `done` once archived;
 * `failed` before the switch only, the old Source staying the Source.
 */
export const SOURCE_MIGRATION_STATES = ['draining', 'copying', 'verifying', 'switched', 'done', 'failed'] as const;
export const zSourceMigrationState = z.enum(SOURCE_MIGRATION_STATES);
export type SourceMigrationState = z.infer<typeof zSourceMigrationState>;

/** A migration in these states holds its Projet: one at a time, the group's new work waits. */
export const RUNNING_SOURCE_MIGRATION_STATES = ['draining', 'copying', 'verifying', 'switched'] as const satisfies readonly SourceMigrationState[];

/** How many items `waitingItems` names at most: the panel names a few, then counts. */
export const SOURCE_MIGRATION_WAITING_ITEMS_MAX = 50;

/** An item the draining waits for: its type, and its number when it has one (a Ticket's). */
export const zSourceMigrationWaitingItem = z.object({ itemType: zArtifactType, number: z.int().positive().optional() });
export type SourceMigrationWaitingItem = z.infer<typeof zSourceMigrationWaitingItem>;

/**
 * A migration of one group of a Projet from one Source to the other (US-102):
 * its state, the Runner's counts, the items the draining waits for, the
 * error code of its failure, its attempt (« Réessayer » adds one). Its
 * fingerprints stay on the server, content-free, the proof of what was
 * moved. The payload of `source-migration.upserted`, an item of
 * `GET /api/projects/:id/source-migrations` and of the `sourceMigrations`
 * slice of `GET /api/state`.
 */
export const zSourceMigration = z.object({
  id: zId,
  projectId: zId,
  group: zSourceGroup,
  from: zSourceKind,
  to: zSourceKind,
  state: zSourceMigrationState,
  total: z.int().min(0),
  copied: z.int().min(0),
  waitingItems: z.array(zSourceMigrationWaitingItem).max(SOURCE_MIGRATION_WAITING_ITEMS_MAX),
  errorCode: zErrorCode.nullable(),
  attempt: z.int().min(1),
  createdAt: zInstant,
  switchedAt: zInstant.nullable(),
  endedAt: zInstant.nullable(),
});
export type SourceMigration = z.infer<typeof zSourceMigration>;

/**
 * The new place a migration picks when the Projet has none on `to`
 * (SOURCE-9): a repository of the installation that no Projet follows, or
 * the folder the Pilote picked beforehand (`POST
 * /api/projects/:id/sources/:group/folder`), which the Runner holds.
 */
export const zSourceMigrationTarget = z.union([z.strictObject({ repositoryId: zId }), z.strictObject({ folder: z.literal(true) })]);
export type SourceMigrationTarget = z.infer<typeof zSourceMigrationTarget>;

/** `POST /api/projects/:id/sources/:group/migrate`, the Action sensible `source.migrate`: the Source to move to, its new place when the Projet has none there, at the `seq` the Pilote confirmed on. */
export const zMigrateSourceInput = withSeq(z.object({ to: zSourceKind, target: zSourceMigrationTarget.optional() }));
export type MigrateSourceInput = z.infer<typeof zMigrateSourceInput>;

/**
 * `POST /api/projects/:id/sources/:group/folder` (SOURCE-9): the folder a
 * migration of `group` to Local will use, sealed for the Runner
 * (`project:<id>:folder`) under `vaultKeyVersion`; the Runner checks it
 * again and holds it as the Projet's pending folder until the switch.
 */
export const zPickSourceFolderInput = z.object({ folderSealed: zSealedItem, vaultKeyVersion: zVaultKeyVersion });
export type PickSourceFolderInput = z.infer<typeof zPickSourceFolderInput>;

/** `POST /api/source-migrations/:id/retry` (« Réessayer »): at the `seq` the Pilote saw the failure on. */
export const zRetrySourceMigrationInput = withSeq(z.object({}));
export type RetrySourceMigrationInput = z.infer<typeof zRetrySourceMigrationInput>;

/** `GET /api/projects/:id/source-migrations?state=`: newest first, 50 per page. */
export const zSourceMigrationQuery = zCursorQuery.extend({ state: zSourceMigrationState.optional() });
export type SourceMigrationQuery = z.infer<typeof zSourceMigrationQuery>;
export const zSourceMigrationPage = zCursorPage(zSourceMigration);
export type SourceMigrationPage = z.infer<typeof zSourceMigrationPage>;

/**
 * What a migration's GitHub token may do (SOURCE-8, ADR 0002): the issues of
 * the Projet's repository only (their labels, milestones, comments, sub-issues,
 * blocked-by and lock with them), 1 h. Never the code.
 */
export const SOURCE_MIGRATION_TOKEN_PERMISSIONS = { issues: 'write' } as const satisfies InstallationPermissions;

/**
 * What the token of a migration of the `code` group may do (SOURCE-9): push
 * the branches (`contents`, `workflows` for those that hold
 * `.github/workflows/`), open the PRs and their comments, on the
 * migration's repository only.
 */
export const SOURCE_MIGRATION_CODE_TOKEN_PERMISSIONS = { contents: 'write', pull_requests: 'write', workflows: 'write' } as const satisfies InstallationPermissions;

/**
 * `POST /api/runner/source-migrations/:id/github-token`, with the Runner's
 * token, while the migration is `copying`, `verifying` or `switched`: the
 * installation token the Runner copies and freezes the issues with, and when
 * it expires. Kept in memory only by the Runner; never stored nor logged.
 */
export const zSourceMigrationGithubToken = z.object({
  token: z.string().min(1),
  expiresAt: zInstant,
});
export type SourceMigrationGithubToken = z.infer<typeof zSourceMigrationGithubToken>;
