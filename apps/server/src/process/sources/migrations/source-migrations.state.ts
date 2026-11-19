import type { SourceMigration } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../../../realtime/state-contributors.js';
import type { Tx } from '../../../realtime/transactions.js';
import { SOURCE_MIGRATION_VIEW, toSourceMigration } from './source-migration.view.js';

/**
 * The migrations the page shows (scoped by `tx`): every one not `done`,
 * and the last `done` of each Projet's group, which the Sources panel
 * reads for « migré de <De> ».
 */
export const readStateMigrations = async (tx: Pick<Tx, 'sourceMigration'>): Promise<SourceMigration[]> => {
  const [open, done] = await Promise.all([
    tx.sourceMigration.findMany({ where: { state: { not: 'done' } }, select: SOURCE_MIGRATION_VIEW, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.sourceMigration.findMany({
      where: { state: 'done' },
      select: SOURCE_MIGRATION_VIEW,
      orderBy: [{ projectId: 'asc' }, { group: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['projectId', 'group'],
    }),
  ]);
  return [...open, ...done].map(toSourceMigration);
};

/** The `sourceMigrations` slice of `GET /api/state`. */
@Injectable()
export class SourceMigrationsState implements StateContributor<'sourceMigrations'>, OnModuleInit {
  readonly key = 'sourceMigrations';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<SourceMigration[]> {
    return readStateMigrations(tx);
  }
}
