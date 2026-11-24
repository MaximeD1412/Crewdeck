import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { InventoryService } from './inventory.service.js';

/**
 * At the server's start, the Inventaire of every Projet still `pending`
 * (PROJET-4): one followed while the server could not start it (no Moteur
 * of the Rôle Conception yet, a deploy in between). One unscoped query of
 * the Pilotes concerned (the one read of `src/projects/inventory/` allowed
 * `prisma.unscoped`, ADR 0008), then each Pilote in their own scope.
 */
@Injectable()
export class InventoryBoot implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    @InjectPinoLogger(InventoryBoot.name) private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      // PostgreSQL away at boot: the server still starts; a Runner online, or the next start, retries.
      this.logger.error({ err: error }, 'inventory boot failed');
    }
  }

  /** How many Inventaires started. */
  async run(): Promise<number> {
    const pilots = await this.prisma.unscoped.project.findMany({ where: { inventoryState: 'pending' }, select: { pilotId: true }, distinct: ['pilotId'], orderBy: { pilotId: 'asc' } });
    let started = 0;
    for (const { pilotId } of pilots) started += await this.inventory.startPending(pilotId);
    if (started > 0) this.logger.info({ projects: started }, 'inventory boot');
    return started;
  }
}
