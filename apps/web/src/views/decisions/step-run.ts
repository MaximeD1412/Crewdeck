import type { Decision } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { rerun } from '../../api/step-runs.js';
import type { DecisionAction, DecisionReads } from './registry.js';

/** A param of the Décision as text, `null` when absent or empty. */
export const textParam = (decision: Pick<Decision, 'params'>, name: string): string | null => {
  const value = decision.params[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const NUMBER = /^[1-9][0-9]*$/;

/**
 * The title of a Décision about one pass of an Étape (ATOI-2): its label,
 * the Étape's name and, when the server could read it, the item's; when it
 * could not (a Local Ticket's sealed title), the Ticket's title the page
 * holds is added: « Code · #57 Recherche d’actes ».
 */
export const stepRunTitle = (decision: Decision, reads: DecisionReads): string => {
  const itemId = textParam(decision, 'itemId');
  if (decision.params['itemLabelled'] !== false || textParam(decision, 'itemType') !== 'ticket' || decision.projectId === null || itemId === null || !NUMBER.test(itemId)) {
    return decision.label;
  }
  const number = Number(itemId);
  const title = reads.ticketTitle(decision.projectId, number);
  return title === null ? decision.label : t('decision.stepRun.title', { label: decision.label, number, title });
};

/**
 * « Relancer l’Étape » and « Voir », the buttons of « Contrat incomplet » and
 * « Étape échouée »: a new pass of the Étape, which needs no Runner (its
 * Session waits for it, `starting`), and the item's page.
 */
export const STEP_RUN_ACTIONS: readonly DecisionAction[] = [
  {
    id: 'rerun',
    label: 'decision.stepRun.rerun',
    primary: true,
    needsRunner: false,
    run: async (decision, { client }) => {
      await rerun(client, textParam(decision, 'stepRunId') ?? decision.subjectId);
    },
  },
  {
    id: 'open',
    label: 'decision.stepRun.open',
    run: (decision, { navigate }) => navigate(decision.link),
  },
];
