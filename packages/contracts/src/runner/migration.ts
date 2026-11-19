import { z } from 'zod';
import { zErrorCode } from '../api/errors.js';
import { zSourceGroup, zSourceKind } from '../process/sources.js';
import { zId } from '../values.js';
import { runnerMessage } from './envelope.js';

/**
 * The messages of a migration of Source (US-102, ADR 0012, « Moving a
 * Source »): the server orchestrates its states, the Runner copies, verifies
 * and freezes. Content-free both ways: identifiers, counts, states and
 * hashes, never a title, a body or a file (ADR 0003).
 */

/** How many fingerprints one migration carries at most: one per item moved. */
export const MIGRATION_FINGERPRINTS_MAX = 20_000;

/** What a moved item was, without its content: its key (`ticket:12`, `file:docs/prd.md`), its state and the hash of its content. */
export const zMigrationFingerprint = z.strictObject({
  key: z.string().min(1).max(300),
  state: z.string().min(1).max(40),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type MigrationFingerprint = z.infer<typeof zMigrationFingerprint>;

/**
 * Server → Runner: copy the group's items from `from` to `to`, the copy
 * reusing what it finds of an earlier attempt; resent after each `hello`
 * while the migration is `copying` or `verifying`. `repository` is the
 * Projet's when one of the two is GitHub.
 */
export const zMigrationCopy = runnerMessage('migration.copy', {
  migrationId: zId,
  projectId: zId,
  group: zSourceGroup,
  from: zSourceKind,
  to: zSourceKind,
  repository: z.strictObject({ owner: z.string().min(1).max(100), name: z.string().min(1).max(100) }).optional(),
});
export type MigrationCopy = z.infer<typeof zMigrationCopy>;

/** Runner → server: how far the copy, then its verification, went. */
export const zMigrationProgress = runnerMessage('migration.progress', {
  migrationId: zId,
  total: z.int().min(0),
  copied: z.int().min(0),
  state: z.enum(['copying', 'verifying']),
});
export type MigrationProgress = z.infer<typeof zMigrationProgress>;

/**
 * Runner → server: everything is copied and verified; the server switches
 * the Source in one transaction. `renumbering` maps the items whose number
 * changed (a Local Ticket become an issue).
 */
export const zMigrationSwitch = runnerMessage('migration.switch', {
  migrationId: zId,
  fingerprints: z.array(zMigrationFingerprint).max(MIGRATION_FINGERPRINTS_MAX),
  renumbering: z.array(z.strictObject({ from: z.int().positive(), to: z.int().positive() })).max(MIGRATION_FINGERPRINTS_MAX),
});
export type MigrationSwitch = z.infer<typeof zMigrationSwitch>;

/** Server → Runner, once switched: archive and freeze the old place, checked against the fingerprints; resent until `migration.finished`. */
export const zMigrationFinish = runnerMessage('migration.finish', {
  migrationId: zId,
  fingerprints: z.array(zMigrationFingerprint).max(MIGRATION_FINGERPRINTS_MAX),
});
export type MigrationFinish = z.infer<typeof zMigrationFinish>;

/** Runner → server: the old place is archived, frozen. */
export const zMigrationFinished = runnerMessage('migration.finished', { migrationId: zId });
export type MigrationFinished = z.infer<typeof zMigrationFinished>;

/** Runner → server: the copy (`copy`, before the switch) or the archiving (`finish`, after it) failed, with its error code. */
export const MIGRATION_FAILURE_STAGES = ['copy', 'finish'] as const;
export const zMigrationFailed = runnerMessage('migration.failed', {
  migrationId: zId,
  stage: z.enum(MIGRATION_FAILURE_STAGES),
  code: zErrorCode,
});
export type MigrationFailed = z.infer<typeof zMigrationFailed>;
