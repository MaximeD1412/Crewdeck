import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunnerClock } from './clock.js';
import { OFFLINE_AFTER_MS, RunnerPresence } from './runner-presence.service.js';

/** How often the Runners without a recent heartbeat are looked for. */
export const SWEEP_EVERY_MS = 5_000;

/**
 * Every 5 s, the Runners « en ligne » whose last heartbeat is older than
 * `OFFLINE_AFTER_SECONDS` go offline, each in its Pilote's scope
 * (`RunnerPresence.expire`). The rows say it, not the sockets: a Runner left
 * online by a server that stopped goes offline too. Of every Pilote at once,
 * so it reads the ids with `prisma.unscoped` (ESLint allows this file), and
 * nothing else.
 */
@Injectable()
export class RunnerSweep {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: RunnerPresence,
    private readonly clock: RunnerClock,
    @InjectPinoLogger(RunnerSweep.name) private readonly logger: PinoLogger,
  ) {}

  @Interval('runner-sweep', SWEEP_EVERY_MS)
  async run(): Promise<void> {
    try {
      await this.sweep();
    } catch (error) {
      this.logger.error({ err: error }, 'runner sweep failed');
    }
  }

  /** How many Runners went offline. */
  async sweep(now = this.clock.now()): Promise<number> {
    const cutoff = new Date(now.getTime() - OFFLINE_AFTER_MS);
    const stale = await this.prisma.unscoped.runner.findMany({ where: { state: 'online', lastSeenAt: { lt: cutoff } }, select: { id: true, pilotId: true } });
    let expired = 0;
    for (const runner of stale) if (await this.presence.expire(runner.pilotId, runner.id, cutoff)) expired++;
    return expired;
  }
}
