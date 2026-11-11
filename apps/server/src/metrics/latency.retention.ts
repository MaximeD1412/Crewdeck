import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service.js';

/** How long the latency samples are kept: the p95 reads 7 days, the rest is margin. */
export const LATENCY_SAMPLES_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes the latency samples older than `LATENCY_SAMPLES_KEPT_MS`, every day
 * at 04:10 UTC. Of every Pilote at once, so with `prisma.unscoped` (ESLint
 * allows this file): it reads nothing and deletes by age only.
 */
@Injectable()
export class LatencyRetention {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(LatencyRetention.name) private readonly logger: PinoLogger,
  ) {}

  @Cron('10 4 * * *', { name: 'latency-retention', timeZone: 'UTC' })
  async run(): Promise<void> {
    try {
      await this.purge();
    } catch (error) {
      this.logger.error({ err: error }, 'latency retention failed');
    }
  }

  /** Deletes the samples measured before `now - LATENCY_SAMPLES_KEPT_MS`; how many. */
  async purge(now = new Date()): Promise<number> {
    const { count } = await this.prisma.unscoped.latencySample.deleteMany({ where: { at: { lt: new Date(now.getTime() - LATENCY_SAMPLES_KEPT_MS) } } });
    this.logger.info({ deleted: count }, 'latency retention');
    return count;
  }
}
