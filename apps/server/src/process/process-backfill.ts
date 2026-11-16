import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Transactions } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { ProcessService } from './process.service.js';

/** Another start wrote the Projet's version 1 first: the unique `(projectId, number)`, or the draft's `projectId`. */
const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * The Projets followed before PROCESS-3 get their Process at the server's
 * start: the definition is TypeScript data of the release, not SQL of the
 * migration. One unscoped query of the Projets with neither a version nor a
 * draft, of every Pilote (the one read of `src/process/` allowed
 * `prisma.unscoped`, ADR 0008), then each in its Pilote's scope and its own
 * transaction. Idempotent: a second start finds none, and two starts at once
 * meet on the unique keys.
 */
@Injectable()
export class ProcessBackfill implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly process: ProcessService,
    @InjectPinoLogger(ProcessBackfill.name) private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      // PostgreSQL away at boot: the server still starts (`db: down` on /api/health); the next start backfills.
      this.logger.error({ err: error }, 'process backfill failed');
    }
  }

  /** How many Projets got their Process. */
  async run(): Promise<number> {
    const pending = await this.prisma.unscoped.project.findMany({
      where: { processVersions: { none: {} }, processDraft: { is: null } },
      select: { id: true, pilotId: true },
      orderBy: { id: 'asc' },
    });
    let written = 0;
    for (const { id, pilotId } of pending) {
      try {
        await runInPilotScope(pilotId, () =>
          this.transactions.run(async (tx) => {
            if ((await tx.processVersion.count({ where: { projectId: id } })) + (await tx.processDraft.count({ where: { projectId: id } })) > 0) return;
            await this.process.createInitialVersion(tx, id, { template: 'process-crewdeck' });
            written += 1;
          }),
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    if (written > 0) this.logger.info({ projects: written }, 'process backfill');
    return written;
  }
}
