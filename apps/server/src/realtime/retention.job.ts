import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service.js';

/** How long the events are kept (ADR 0007): a page closed for longer loads the snapshot. */
export const EVENTS_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deletes the events older than `EVENTS_KEPT_MS`, every day at 04:00 UTC.
 * Of every Pilote at once: the one job of the server allowed `prisma.unscoped`
 * (ADR 0008), as it reads nothing and deletes by age only.
 */
@Injectable()
export class EventsRetention {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(EventsRetention.name) private readonly logger: PinoLogger,
  ) {}

  @Cron('0 4 * * *', { name: 'events-retention', timeZone: 'UTC' })
  async run(): Promise<void> {
    try {
      await this.purge();
    } catch (error) {
      this.logger.error({ err: error }, 'events retention failed');
    }
  }

  /** Deletes the events written before `now - EVENTS_KEPT_MS`; how many. */
  async purge(now = new Date()): Promise<number> {
    const { count } = await this.prisma.unscoped.event.deleteMany({ where: { at: { lt: new Date(now.getTime() - EVENTS_KEPT_MS) } } });
    this.logger.info({ deleted: count }, 'events retention');
    return count;
  }
}
