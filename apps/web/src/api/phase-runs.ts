import { type PhaseRun, zPhaseRun } from '@crewdeck/contracts';
import type { Client } from './client.js';

const answer = (client: Pick<Client, 'command'>, phaseRunId: string, decisionId: string, path: 'one-more-pass' | 'stop'): Promise<PhaseRun> =>
  client.command('POST', `/api/phase-runs/${encodeURIComponent(phaseRunId)}/${path}`, { decisionId }, zPhaseRun);

/**
 * `POST /api/phase-runs/:id/one-more-pass` (PROCESS-6): « Encore un
 * passage » on the Décision `decisionId`, the Retour taken once more; the
 * answer is the PhaseRun `running` again, whose events the store gets too.
 * A refusal is an `ApiError` (409 already answered, 422 no Retour).
 */
export const oneMorePass = (client: Pick<Client, 'command'>, phaseRunId: string, decisionId: string): Promise<PhaseRun> =>
  answer(client, phaseRunId, decisionId, 'one-more-pass');

/** `POST /api/phase-runs/:id/stop` (PROCESS-6): « Arrêter » on the Décision `decisionId`, the PhaseRun and its item stopped. */
export const stopPhaseRun = (client: Pick<Client, 'command'>, phaseRunId: string, decisionId: string): Promise<PhaseRun> =>
  answer(client, phaseRunId, decisionId, 'stop');
