import { type Health, zInstant } from '@crewdeck/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { ZodResponse } from 'nestjs-zod';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../scope/public.decorator.js';
import { HealthDto } from './health.dto.js';

/**
 * `GET /api/health`: public (no session), returns no secret, only the commit
 * and, in production, the instant of the last successful backup.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The server is up.', type: HealthDto })
  async health(): Promise<Health> {
    const health: Health = { status: 'ok', commit: this.env.CREWDECK_COMMIT, db: await this.database() };
    const file = this.env.BACKUP_STATUS_FILE;
    if (file !== undefined) health.backup = { lastSuccessAt: await this.lastBackup(file) };
    return health;
  }

  private async database(): Promise<Health['db']> {
    try {
      await this.prisma.ping();
      return 'ok';
    } catch {
      return 'down';
    }
  }

  /**
   * The instant `infra/backup/bin/backup.sh` wrote after its last success,
   * read at each request: the backup rewrites it every night. Null while no
   * backup has succeeded (no file, an empty one) or when it holds anything
   * else than an instant.
   */
  private async lastBackup(file: string): Promise<string | null> {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      return null;
    }
    const instant = zInstant.safeParse(content.trim());
    return instant.success ? instant.data : null;
  }
}
