import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Transactions } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { ProcessService } from './process.service.js';

/** Another start wrote the Projet's version 1 first: the unique `(projectId, number)`, or the draft's `projectId`. */
const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** The groups every Projet holds (SOURCE-1). */
const GROUPS = ['ticket', 'code'] as const;

/**
 * At the server's start, before it serves a state: first the Sources a
 * Projet lacks, then the Process of the Projets followed before PROCESS-3
 * (the definition is TypeScript data of the release, not SQL of the
 * migration). Each is one unscoped query of the Projets concerned, of every
 * Pilote (the one read of `src/process/` allowed `prisma.unscoped`, ADR
 * 0008), then each Projet in its Pilote's scope and its own transaction.
 * Idempotent: a second start finds none, and two starts at once meet on the
 * unique keys.
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

  /** How many Projets got their Process, after the Sources a Projet lacked (`completeSources`). */
  async run(): Promise<number> {
    await this.completeSources();
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

  /**
   * The Sources of the Projets without both groups: the migration filled
   * those followed before it, but the previous release may still follow one
   * after it (during a deploy, or its rollback), which then has none and
   * whose view would throw. Such a Projet is a Dépôt GitHub: each group it
   * lacks on GitHub, since it was followed. How many Projets were completed.
   */
  async completeSources(): Promise<number> {
    const pending = await this.prisma.unscoped.project.findMany({
      where: { OR: GROUPS.map((group) => ({ artifactSources: { none: { group } } })) },
      select: { id: true, pilotId: true, followedAt: true },
      orderBy: { id: 'asc' },
    });
    let written = 0;
    for (const { id, pilotId, followedAt } of pending) {
      await runInPilotScope(pilotId, () =>
        this.transactions.run(async (tx) => {
          const { count } = await tx.artifactSource.createMany({
            data: GROUPS.map((group) => ({ id: newId(), pilotId, projectId: id, group, source: 'github' as const, since: followedAt })),
            skipDuplicates: true,
          });
          if (count > 0) written += 1;
        }),
      );
    }
    if (written > 0) this.logger.info({ projects: written }, 'sources backfill');
    return written;
  }
}
