import type { Decision } from '@crewdeck/contracts';
import { t, type MessageKey } from '@crewdeck/sdk';
import { oneMorePass, stopPhaseRun } from '../../api/phase-runs.js';
import { registerDecisionView, type DecisionView } from './registry.js';

const text = (decision: Pick<Decision, 'params'>, name: string): string | null => {
  const value = decision.params[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
};
const count = (decision: Pick<Decision, 'params'>, name: string): number | null => {
  const value = decision.params[name];
  return typeof value === 'number' ? value : null;
};

/** What stopped, by the item's type: « le Ticket s’est arrêté ». */
const STOPPED: Readonly<Record<string, MessageKey>> = {
  ticket: 'decision.loopBack.stopped.ticket',
  idea: 'decision.loopBack.stopped.idea',
};

/** Whether « Encore un passage » is offered: a Retour reached its maximum, one more pass may be allowed. */
export const canContinue = (decision: Pick<Decision, 'params'>): boolean => decision.params['canContinue'] === true;

/** The PhaseRun the Décision is about, which its answers name. */
const phaseRunOf = (decision: Pick<Decision, 'params' | 'subjectId'>): string => text(decision, 'phaseRunId') ?? decision.subjectId;

/**
 * « Maximum de Retours atteint » in « À toi » (PROCESS-6, ADR 0011): « Review
 * a demandé des changements 4 fois, le maximum de son Retour vers « Code » :
 * le Ticket s’est arrêté. » (the changes asked counted, `taken + 1`), or,
 * when no Retour leaves the Étape, that it has none. « Encore un passage »
 * (only while a Retour may be taken), « Arrêter », and « Voir la Session »
 * when the server named one.
 */
export const loopBackExhaustedView: DecisionView = {
  context: (decision) => {
    const step = text(decision, 'stepName') ?? '';
    const stopped = t(STOPPED[text(decision, 'itemType') ?? ''] ?? 'decision.loopBack.stopped.other');
    const target = text(decision, 'targetName');
    const taken = count(decision, 'taken');
    if (target === null || taken === null) return t('decision.loopBack.contextNoLoopBack', { step, stopped });
    return t('decision.loopBack.context', { step, count: taken + 1, target, stopped });
  },
  actions: [
    {
      id: 'one-more-pass',
      label: 'decision.loopBack.oneMorePass',
      primary: true,
      shownFor: canContinue,
      run: async (decision, { client }) => {
        await oneMorePass(client, phaseRunOf(decision), decision.id);
      },
    },
    {
      id: 'stop',
      label: 'decision.loopBack.stop',
      run: async (decision, { client }) => {
        await stopPhaseRun(client, phaseRunOf(decision), decision.id);
      },
    },
    {
      id: 'open-session',
      label: 'decision.loopBack.openSession',
      shownFor: (decision) => text(decision, 'sessionId') !== null,
      run: (decision, { navigate }) => navigate(decision.link),
    },
  ],
};

registerDecisionView('loop-back.exhausted', loopBackExhaustedView);
