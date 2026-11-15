import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';

/** How long GitHub's changes are kept (ADR 0010): a Runner away for longer resyncs. */
export const GITHUB_CHANGES_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deletes GitHub's changes older than `GITHUB_CHANGES_KEPT_MS`, every day at
 * 04:15 UTC. Of every Pilote at once, as the events' retention: it reads
 * nothing and deletes by age only (ADR 0008).
 */
@Injectable()
export class GitHubChangesRetention {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(GitHubChangesRetention.name) private readonly logger: PinoLogger,
  ) {}

  @Cron('15 4 * * *', { name: 'github-changes-retention', timeZone: 'UTC' })
  async run(): Promise<void> {
    try {
      await this.purge();
    } catch (error) {
      this.logger.error({ err: error }, 'github changes retention failed');
    }
  }

  /** Deletes the changes received before `now - GITHUB_CHANGES_KEPT_MS`; how many. */
  async purge(now = new Date()): Promise<number> {
    const { count } = await this.prisma.unscoped.gitHubChange.deleteMany({ where: { at: { lt: new Date(now.getTime() - GITHUB_CHANGES_KEPT_MS) } } });
    this.logger.info({ deleted: count }, 'github changes retention');
    return count;
  }
}
