import type { Health } from '@crewdeck/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthDto } from './health.dto.js';

/** `GET /api/health`: public (no session), returns no secret, only the commit. */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The server is up.', type: HealthDto })
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
