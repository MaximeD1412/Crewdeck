import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { RunnerClock } from '../../../runners/clock.js';
import { runInPilotScope } from '../../../scope/scope.context.js';
import { SourceMigrations } from './source-migrations.service.js';

/** How often the finishes due are looked for: each minute, the shortest delay of `FINISH_RETRY_MINUTES`. */
export const FINISH_SWEEP_EVERY_MS = 60_000;

/**
 * Each minute, the migrations `draining` checked again, so that one whose
 * check was lost with a restart goes on; then the migrations `switched` whose `migration.finish` is due
 * again (`nextFinishAt` past, after a failure of finishing) get it, each in
 * its Pilote's scope. Of every Pilote at once, so it reads their ids with
 * `prisma.unscoped` (ESLint allows this file), and nothing else.
 */
@Injectable()
export class FinishSweep {
  constructor(
    private readonly prisma: PrismaService,
    private readonly migrations: SourceMigrations,
    private readonly clock: RunnerClock,
    @InjectPinoLogger(FinishSweep.name) private readonly logger: PinoLogger,
  ) {}

  @Interval('source-migration-finish-sweep', FINISH_SWEEP_EVERY_MS)
  async run(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error({ err: error }, 'source migration finish sweep failed');
    }
  }

  /** How many finishes were sent again; the migrations left `draining` (by a restart) checked again first. */
  async sweep(now = this.clock.now()): Promise<number> {
    const draining = await this.prisma.unscoped.sourceMigration.findMany({ where: { state: 'draining' }, select: { id: true, pilotId: true } });
    for (const { id, pilotId } of draining) await runInPilotScope(pilotId, () => this.migrations.resumeDrain(id));
    const due = await this.prisma.unscoped.sourceMigration.findMany({
      where: { state: 'switched', nextFinishAt: { lte: now } },
      select: { pilotId: true },
      distinct: ['pilotId'],
    });
    let sent = 0;
    for (const { pilotId } of due) sent += await runInPilotScope(pilotId, () => this.migrations.resendDueFinishes(now));
    return sent;
  }
}
