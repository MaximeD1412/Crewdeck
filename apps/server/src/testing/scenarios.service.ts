import type { ScenarioRun } from '@crewdeck/contracts';
import type { AddressInfo } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunnerLinkLimiter } from '../runners/link/link-limiter.js';
import { FAKES, type Fakes, resetFakes } from './fakes.js';
import type { Scenario } from './scenarios/index.js';

/** Prisma's own table, the only one a scenario keeps. */
const MIGRATIONS_TABLE = '_prisma_migrations';

const quote = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

/** How many times the TRUNCATE is tried when PostgreSQL picks it as a deadlock's victim. */
const TRUNCATE_ATTEMPTS = 5;

/** PostgreSQL's `deadlock detected`, as Prisma's driver adapter reports it. */
const isDeadlock = (error: unknown): boolean =>
  (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } }).meta?.driverAdapterError?.cause?.originalCode === '40P01';

@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FAKES) private readonly fakes: Fakes,
    private readonly adapterHost: HttpAdapterHost,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Empties the data tables, resets the fakes and the link attempts' count, then seeds the scenario, its Runner connected when it links one. */
  async run(scenario: Scenario): Promise<ScenarioRun> {
    await resetFakes(this.fakes);
    this.moduleRef.get(RunnerLinkLimiter, { strict: false }).reset();
    await this.emptyDatabase();
    const seeded = await scenario.seed({ prisma: this.prisma, fakes: this.fakes });
    if (seeded.runnerToken) await this.fakes.runner.connect(this.ownUrl(), seeded.runnerToken, seeded.runnerMachine);
    return { name: scenario.name, path: scenario.path, sessionCookie: seeded.sessionCookie ?? null };
  }

  /**
   * Every table of the current schema, the models' and any other, but the
   * migrations': every Pilote's, so unscoped. The previous scenario's fake
   * Runner, just disconnected, may still be writing its Runner offline: when
   * PostgreSQL resolves that deadlock against the TRUNCATE, it is tried again.
   */
  private async emptyDatabase(): Promise<void> {
    const tables = await this.prisma.unscoped.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> ${MIGRATIONS_TABLE} ORDER BY tablename`;
    if (tables.length === 0) return;
    const truncate = `TRUNCATE TABLE ${tables.map((t) => quote(t.tablename)).join(', ')} RESTART IDENTITY CASCADE`;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.prisma.unscoped.$executeRawUnsafe(truncate);
        return;
      } catch (error) {
        if (!isDeadlock(error) || attempt === TRUNCATE_ATTEMPTS) throw error;
      }
    }
  }

  /** This server's own address, which the fake Runner connects to. */
  private ownUrl(): string {
    const { port } = this.adapterHost.httpAdapter.getHttpServer().address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }
}
