import type { SourceMigration } from '@crewdeck/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { afterCommit, type Tx } from '../../../realtime/transactions.js';
import { currentPilotId, runInPilotScope } from '../../../scope/scope.context.js';
import { TicketsReconcile } from '../../../tickets/tickets.reconcile.js';
import { TicketsWriter } from '../../../tickets/tickets.writer.js';
import { SourceMigrations, type SwitchMessage } from './source-migrations.service.js';

/**
 * A renumbering as a map, old → new, for the numbers a row holds: a number
 * given twice on either side, or a held number missing, throws; a number no
 * row holds (a closed milestone, an issue not reconciled yet) is left out.
 */
export const renumberingOf = (what: string, pairs: readonly { from: number; to: number }[], held: readonly number[]): Map<number, number> => {
  const map = new Map<number, number>();
  const seen = new Set<number>();
  const taken = new Set<number>();
  const rows = new Set(held);
  for (const { from, to } of pairs) {
    if (seen.has(from) || taken.has(to)) throw new Error(`${what}: a number renumbered twice`);
    seen.add(from);
    taken.add(to);
    if (rows.has(from)) map.set(from, to);
  }
  const missing = held.filter((number) => !map.has(number));
  if (missing.length > 0) throw new Error(`${what}: the renumbering misses ${missing.length} rows`);
  return map;
};

/**
 * The `ticket` group's switch (SOURCE-8, ADR 0012), in the switch's
 * transaction: every Ticket and milestone of the Projet to its new number
 * and Source, its number and Source before kept (« #57 (ex-#12) »). To
 * GitHub, the reconciliation of the Projet runs once committed and fills the
 * titles; to Local, the Runner's scan seals them again. A renumbering that
 * misses a row throws: SOURCE-7 then fails the
 * migration on the old Source.
 */
@Injectable()
export class TicketsSwitch implements OnModuleInit {
  constructor(
    private readonly migrations: SourceMigrations,
    private readonly writer: TicketsWriter,
    private readonly reconcile: TicketsReconcile,
    @InjectPinoLogger(TicketsSwitch.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.migrations.registerSwitchHook('ticket', (tx, migration, message) => this.switch(tx, migration, message));
  }

  async switch(tx: Tx, migration: SourceMigration, message: SwitchMessage): Promise<void> {
    const { projectId } = migration;
    const tickets = await tx.ticket.findMany({ where: { projectId }, select: { number: true } });
    const milestones = await tx.milestone.findMany({ where: { projectId }, select: { number: true } });
    const move = {
      from: migration.from,
      to: migration.to,
      tickets: renumberingOf('tickets', message.renumbering, tickets.map((row) => row.number)),
      milestones: renumberingOf('milestones', message.milestones ?? [], milestones.map((row) => row.number)),
    };
    await this.writer.moveTickets(tx, projectId, move);
    if (migration.to !== 'github') return;
    const pilotId = currentPilotId();
    afterCommit(tx, () => {
      runInPilotScope(pilotId, () => this.reconcile.reconcileProjectTickets(pilotId, projectId)).catch((error: unknown) => this.logger.warn({ err: error, projectId }, 'tickets reconcile after switch failed'));
    });
  }
}
