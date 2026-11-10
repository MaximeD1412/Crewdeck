import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { pilotScope, runtimeModels } from '../scope/prisma-scope.extension.js';

const extend = (client: PrismaClient) => client.$extends(pilotScope(runtimeModels(client)));

/** The client every module queries with: each scoped model within the current Pilote's scope (ADR 0008). */
export type ScopedPrisma = ReturnType<typeof extend>;

/**
 * The Prisma 7 clients, on one connection pool. It connects on its first
 * query, so that the server boots, and says `db: down` on `/api/health`,
 * while PostgreSQL is away.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  /**
   * The raw client, outside any scope. ESLint allows it only in `src/scope/`,
   * `src/auth/`, `src/github/webhooks/` and `src/testing/`.
   */
  readonly unscoped: PrismaClient;
  /** `pilotScope` on the raw client: `pilotId` added to every query of a scoped model, a throw outside a scope, no raw SQL. */
  readonly scoped: ScopedPrisma;

  constructor(@Inject(ENV) env: Env) {
    this.unscoped = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
    this.scoped = extend(this.unscoped);
  }

  /** Resolves when PostgreSQL answers, rejects otherwise. */
  async ping(): Promise<void> {
    await this.unscoped.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.unscoped.$disconnect();
  }
}
