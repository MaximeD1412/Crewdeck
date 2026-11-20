import { t, type MessageKey } from '@crewdeck/sdk';
import { registerDecisionView, type DecisionView } from './registry.js';
import { STEP_RUN_ACTIONS, stepRunTitle, textParam } from './step-run.js';

/** Why the Session stopped, by the StepRun's failure. */
const CONTEXTS: Readonly<Record<string, MessageKey>> = {
  'session-error': 'decision.stepFailed.context.session-error',
  'session-stopped': 'decision.stepFailed.context.session-stopped',
  'no-engine': 'decision.stepFailed.context.no-engine',
};

/**
 * « Étape échouée » in « À toi » (ATOI-2, ADR 0005): the Étape (and its
 * item), the Phase in the meta, « La session s’est arrêtée en erreur. » or
 * « Le Runner a arrêté la session. », or that its Rôle had no Moteur to start
 * one; « Relancer l’Étape », « Voir ».
 */
export const stepFailedView: DecisionView = {
  title: stepRunTitle,
  context: (decision) => {
    const key = CONTEXTS[textParam(decision, 'failure') ?? ''];
    return key === undefined ? null : t(key);
  },
  actions: STEP_RUN_ACTIONS,
};

registerDecisionView('step-failed', stepFailedView);
