import type { CodeChangeState, SourceMigration } from '@crewdeck/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { afterCommit, type Tx } from '../../../realtime/transactions.js';
import { currentPilotId, runInPilotScope } from '../../../scope/scope.context.js';
import { TicketsReconcile } from '../../../tickets/tickets.reconcile.js';
import { TicketsWriter } from '../../../tickets/tickets.writer.js';
import { SourceMigrations, type SwitchMessage } from './source-migrations.service.js';
import { renumberingOf } from './tickets.switch.js';

/** The changes of code a migration copies: the open ones, drafts included. */
const COPIED: readonly CodeChangeState[] = ['draft', 'open'];

/**
 * What the switch does to the Projet's changes of code: the open ones (and
 * drafts) to their new numbers, the merged and closed ones removed, their
 * records not copied (their branches are). A renumbering that misses an
 * open one or names another throws.
 */
export const codeChangesPlan = (
  rows: readonly { readonly number: number; readonly state: CodeChangeState }[],
  pairs: readonly { from: number; to: number }[],
): { readonly moves: Map<number, number>; readonly removed: number[] } => ({
  moves: renumberingOf(
    'changes of code',
    pairs,
    rows.filter((row) => COPIED.includes(row.state)).map((row) => row.number),
  ),
  removed: rows.filter((row) => !COPIED.includes(row.state)).map((row) => row.number),
});

/**
 * The `code` group's switch (SOURCE-9, ADR 0012), in the switch's
 * transaction, once SOURCE-7 made the new place the Projet's (the
 * repository picked, or the folder): each open change of code to its new
 * number and Source, its number and Source before kept; the merged and
 * closed ones removed. To GitHub, the reconciliation of the Projet runs once
 * committed and fills the titles from its PRs; to Local, the Runner's report
 * seals them again.
 */
@Injectable()
export class CodeSwitch implements OnModuleInit {
  constructor(
    private readonly migrations: SourceMigrations,
    private readonly writer: TicketsWriter,
    private readonly reconcile: TicketsReconcile,
    @InjectPinoLogger(CodeSwitch.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.migrations.registerSwitchHook('code', (tx, migration, message) => this.switch(tx, migration, message));
  }

  async switch(tx: Tx, migration: SourceMigration, message: SwitchMessage): Promise<void> {
    const { projectId } = migration;
    const rows = await tx.codeChange.findMany({ where: { projectId }, select: { number: true, state: true } });
    const plan = codeChangesPlan(rows, message.renumbering);
    for (const number of plan.removed) await this.writer.removeCodeChange(tx, projectId, number);
    await this.writer.moveCodeChanges(tx, projectId, { from: migration.from, to: migration.to, changes: plan.moves });
    if (migration.to !== 'github') return;
    const pilotId = currentPilotId();
    afterCommit(tx, () => {
      runInPilotScope(pilotId, () => this.reconcile.reconcileProjectTickets(pilotId, projectId)).catch((error: unknown) => this.logger.warn({ err: error, projectId }, 'code reconcile after switch failed'));
    });
  }
}
