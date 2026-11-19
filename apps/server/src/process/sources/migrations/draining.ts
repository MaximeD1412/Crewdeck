import { groupsOfPhase, type ProcessDefinition, type SourceGroup, type SourceMigrationState } from '@crewdeck/contracts';
import type { Tx } from '../../../realtime/transactions.js';

/**
 * The states of a migration of Source that hold its group's new work: from
 * `draining` to `verifying`. Once `switched`, the new Source wins (ADR 0012,
 * « Moving a Source »): the held work starts on it while finishing freezes
 * the old place.
 */
export const HOLDING_SOURCE_MIGRATION_STATES = ['draining', 'copying', 'verifying'] as const satisfies readonly SourceMigrationState[];

/** The groups of the Projet whose migration of Source holds the new work. At most one, one migration per Projet at a time. */
export const drainingGroups = async (tx: Pick<Tx, 'sourceMigration'>, projectId: string): Promise<SourceGroup[]> =>
  (await tx.sourceMigration.findMany({ where: { projectId, state: { in: [...HOLDING_SOURCE_MIGRATION_STATES] } }, select: { group: true } })).map((row) => row.group);

/** Whether a new PhaseRun of `phaseId` waits on `source-migration`: its Phase reads or writes a group being migrated. */
export const heldByMigration = async (tx: Pick<Tx, 'sourceMigration'>, projectId: string, definition: ProcessDefinition, phaseId: string): Promise<boolean> => {
  const groups = await drainingGroups(tx, projectId);
  if (groups.length === 0) return false;
  return groupsOfPhase(definition, phaseId).some((group) => groups.includes(group));
};
