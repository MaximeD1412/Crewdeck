import type { ScenarioRun } from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FAKES, type Fakes, resetFakes } from './fakes.js';
import type { Scenario } from './scenarios/index.js';

/** Prisma's own table, the only one a scenario keeps. */
const MIGRATIONS_TABLE = '_prisma_migrations';

const quote = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FAKES) private readonly fakes: Fakes,
  ) {}

  /** Empties the data tables and resets the fakes, then seeds the scenario. */
  async run(scenario: Scenario): Promise<ScenarioRun> {
    await this.emptyDatabase();
    await resetFakes(this.fakes);
    const seeded = await scenario.seed({ prisma: this.prisma, fakes: this.fakes });
    return { name: scenario.name, path: scenario.path, sessionCookie: seeded.sessionCookie ?? null };
  }

  /** Every table of the current schema, the models' and any other, but the migrations': every Pilote's, so unscoped. */
  private async emptyDatabase(): Promise<void> {
    const tables = await this.prisma.unscoped.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> ${MIGRATIONS_TABLE} ORDER BY tablename`;
    if (tables.length === 0) return;
    await this.prisma.unscoped.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => quote(t.tablename)).join(', ')} RESTART IDENTITY CASCADE`);
  }
}
