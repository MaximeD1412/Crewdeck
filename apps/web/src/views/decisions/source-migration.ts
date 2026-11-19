import { zSourceGroup, zSourceKind, type Decision } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { retrySourceMigration } from '../../api/source-migrations.js';
import { sourceLabel } from '../source-migration.js';
import { OPEN_ACTION, registerDecisionView, type DecisionView } from './registry.js';

const text = (decision: Pick<Decision, 'params'>, name: string): string | null => {
  const value = decision.params[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/** The migration's group and Sources, as the server named them in its params; `null` when one is missing. */
const migrationOf = (decision: Pick<Decision, 'params'>) => {
  const group = zSourceGroup.safeParse(decision.params['group']);
  const from = zSourceKind.safeParse(decision.params['from']);
  const to = zSourceKind.safeParse(decision.params['to']);
  if (!group.success || !from.success || !to.success) return null;
  return { group: t(`process.sources.migration.${group.data}.group`), from: sourceLabel(from.data), to: sourceLabel(to.data) };
};

/** The migration the Décision is about, which « Réessayer » names. */
const migrationIdOf = (decision: Pick<Decision, 'params' | 'subjectId'>): string => text(decision, 'migrationId') ?? decision.subjectId;

/**
 * « Migration de Source échouée » in « À toi » (SOURCE-7, US-102): « La
 * migration des Tickets de Local vers GitHub a échoué (copy-failed) : rien
 * n’a basculé, ils restent sur Local. », « Réessayer » (on the Runner) and
 * « Ouvrir » the Sources.
 */
export const sourceMigrationFailedView: DecisionView = {
  context: (decision) => {
    const migration = migrationOf(decision);
    return migration ? t('decision.sourceMigration.failed.context', { ...migration, code: text(decision, 'code') ?? '?' }) : null;
  },
  actions: [
    {
      id: 'retry',
      label: 'decision.sourceMigration.retry',
      primary: true,
      needsRunner: true,
      run: async (decision, { client }) => {
        await retrySourceMigration(client, migrationIdOf(decision));
      },
    },
    OPEN_ACTION,
  ],
};

/**
 * « Ancienne Source pas encore figée » (SOURCE-7): the new Source wins, the
 * old place is not yet frozen, the Runner tries again every hour; « Ouvrir »
 * the Sources. `migration.finished` resolves it.
 */
export const sourceMigrationUnfinishedView: DecisionView = {
  context: (decision) => {
    const migration = migrationOf(decision);
    return migration ? t('decision.sourceMigration.unfinished.context', migration) : null;
  },
  actions: [OPEN_ACTION],
};

registerDecisionView('source-migration.failed', sourceMigrationFailedView);
registerDecisionView('source-migration.unfinished', sourceMigrationUnfinishedView);
