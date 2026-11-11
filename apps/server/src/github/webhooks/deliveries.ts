import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';

/** How long a delivery id is kept: GitHub redelivers within 3 days, by hand or by its API. */
export const DELIVERIES_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The deliveries already received (`github_deliveries`, global): what makes
 * a redelivery of the same `X-GitHub-Delivery` dispatch once (risk SEC-8).
 * Only a delivery whose signature is valid is recorded, so that a forged
 * request cannot fill the table.
 */
@Injectable()
export class GitHubDeliveries {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(GitHubDeliveries.name) private readonly logger: PinoLogger,
  ) {}

  /** Records the delivery; `false` when it was already there. One statement: two copies at once record one. */
  async record(deliveryId: string, event: string, receivedAt: Date): Promise<boolean> {
    const { count } = await this.prisma.unscoped.gitHubDelivery.createMany({ data: [{ deliveryId, event, receivedAt }], skipDuplicates: true });
    return count === 1;
  }

  /** Every day at 04:10 UTC: the deliveries older than `DELIVERIES_KEPT_MS` go. */
  @Cron('10 4 * * *', { name: 'github-deliveries-retention', timeZone: 'UTC' })
  async run(): Promise<void> {
    try {
      await this.prune();
    } catch (error) {
      this.logger.error({ err: error }, 'github deliveries retention failed');
    }
  }

  /** Deletes the deliveries received before `now - DELIVERIES_KEPT_MS`; how many. */
  async prune(now = new Date()): Promise<number> {
    const { count } = await this.prisma.unscoped.gitHubDelivery.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - DELIVERIES_KEPT_MS) } } });
    this.logger.info({ deleted: count }, 'github deliveries retention');
    return count;
  }
}
