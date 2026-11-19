import { groupsOfPhase, type ProcessDefinition, type SourceGroup, type SourceMigrationState } from '@crewdeck/contracts';
import type { Tx } from '../../../realtime/transactions.js';

/**
 * The states of a migration of Source that hold its group's new work: from
 * `draining` to `switched`. The held work starts once the migration is
 * `done` (on the new Source, the old place frozen) or `failed` (on the old
 * one): never while the old place can still be written (SOURCE-7).
 */
export const HOLDING_SOURCE_MIGRATION_STATES = ['draining', 'copying', 'verifying', 'switched'] as const satisfies readonly SourceMigrationState[];

/** The groups of the Projet whose migration of Source holds the new work. At most one, one migration per Projet at a time. */
export const drainingGroups = async (tx: Pick<Tx, 'sourceMigration'>, projectId: string): Promise<SourceGroup[]> =>
  (await tx.sourceMigration.findMany({ where: { projectId, state: { in: [...HOLDING_SOURCE_MIGRATION_STATES] } }, select: { group: true } })).map((row) => row.group);

/** Whether a new PhaseRun of `phaseId` waits on `source-migration`: its Phase reads or writes a group being migrated. */
export const heldByMigration = async (tx: Pick<Tx, 'sourceMigration'>, projectId: string, definition: ProcessDefinition, phaseId: string): Promise<boolean> => {
  const groups = await drainingGroups(tx, projectId);
  if (groups.length === 0) return false;
  return groupsOfPhase(definition, phaseId).some((group) => groups.includes(group));
};
