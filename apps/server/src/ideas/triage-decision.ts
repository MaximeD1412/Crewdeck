import { IDEA_TO_TRIAGE_STATES } from '@crewdeck/contracts';
import type { DecisionsService } from '../decisions/decisions.service.js';
import type { Tx } from '../realtime/transactions.js';
import { ideaStateRow } from './idea.view.js';

/** The label of the Décision: « 1 Idée à trier », « N Idées à trier ». Never an Idée's text (ADR 0003). */
export const triageLabel = (count: number): string => (count === 1 ? '1 Idée à trier' : `${count} Idées à trier`);

/**
 * The Décision `ideas-to-triage` of the Pilote (its subject): open while an
 * Idée is in analysis, to triage or analysed, its label their count, raised
 * or relabelled with `tx`; resolved when none is left. Every command that
 * changes an Idée's state calls it in its transaction.
 */
export const syncIdeasToTriage = async (tx: Tx, pilotId: string, decisions: Pick<DecisionsService, 'raise' | 'resolve'>): Promise<number> => {
  const count = await tx.idea.count({ where: { state: { in: IDEA_TO_TRIAGE_STATES.map(ideaStateRow) } } });
  if (count === 0) {
    await decisions.resolve(tx, 'ideas-to-triage', pilotId, 'triaged');
    return 0;
  }
  await decisions.raise(tx, {
    kind: 'ideas-to-triage',
    projectId: null,
    projectName: null,
    subjectType: 'pilot',
    subjectId: pilotId,
    label: triageLabel(count),
    metaParts: [],
    tone: 'accent',
    link: '/idees',
    params: { count },
  });
  return count;
};
