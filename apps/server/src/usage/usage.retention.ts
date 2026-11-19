import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service.js';

/** How long the windows' measures are kept: the projection reads 24 hours, a week's window 7 days. */
export const USAGE_MEASURES_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes the windows' measures older than `USAGE_MEASURES_KEPT_MS`, every
 * day at 04:20 UTC. Of every Pilote at once, so with `prisma.unscoped`
 * (ESLint allows this file): it reads nothing and deletes by age only. The
 * spends stay: the month's spend, and later the cost of a Ticket, read them.
 */
@Injectable()
export class UsageRetention {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(UsageRetention.name) private readonly logger: PinoLogger,
  ) {}

  @Cron('20 4 * * *', { name: 'usage-retention', timeZone: 'UTC' })
  async run(): Promise<void> {
    try {
      await this.purge();
    } catch (error) {
      this.logger.error({ err: error }, 'usage retention failed');
    }
  }

  /** Deletes the measures taken before `now - USAGE_MEASURES_KEPT_MS`; how many. */
  async purge(now = new Date()): Promise<number> {
    const { count } = await this.prisma.unscoped.usageMeasure.deleteMany({ where: { measuredAt: { lt: new Date(now.getTime() - USAGE_MEASURES_KEPT_MS) } } });
    this.logger.info({ deleted: count }, 'usage retention');
    return count;
  }
}
