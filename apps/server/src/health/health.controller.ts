import type { Health } from '@crewdeck/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** `GET /api/health`: public (no session), returns no secret, only the commit. */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async health(): Promise<Health> {
    return { status: 'ok', commit: this.env.CREWDECK_COMMIT, db: await this.database() };
  }

  private async database(): Promise<Health['db']> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'down';
    }
  }
}
