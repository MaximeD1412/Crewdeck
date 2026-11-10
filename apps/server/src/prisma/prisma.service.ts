import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The Prisma 7 client. It connects on its first query, so that the server
 * boots, and says `db: down` on `/api/health`, while PostgreSQL is away.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
