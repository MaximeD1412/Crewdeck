import { t } from '@crewdeck/sdk';
import { registerDecisionView, type DecisionView } from './registry.js';
import { openSessionPanel, requestEvent } from './session-request.js';

/**
 * « Question de l’agent » in « À toi » (SESSION-3): the Session's title, the
 * question read from the Runner under it (« Ouvre la Session pour lire la
 * question. » when it cannot be), « Répondre » opening the Session's panel.
 */
export const agentQuestionView: DecisionView = {
  context: (decision, reads) => {
    const event = requestEvent(decision, 'question', reads);
    if (event === undefined) return null;
    return event?.title ?? t('decision.agentQuestion.unreadable');
  },
  actions: [{ id: 'answer', label: 'decision.agentQuestion.answer', primary: true, run: openSessionPanel }],
};

registerDecisionView('agent-question', agentQuestionView);
