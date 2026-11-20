import { type StepRunRerunResult, zStepRunRerunResult } from '@crewdeck/contracts';
import type { Client } from './client.js';

/**
 * `POST /api/step-runs/:id/rerun` (ATOI-2): « Relancer l'Étape » on a
 * StepRun of « Contrat incomplet » or « Étape échouée », with the store's
 * `seq`; the answer is the new StepRun (`null` while its Phase holds it),
 * whose events the store gets too. A refusal is an `ApiError` (409 already
 * answered or stale, 422 not rerunnable).
 */
export const rerun = (client: Pick<Client, 'command'>, stepRunId: string): Promise<StepRunRerunResult> =>
  client.command('POST', `/api/step-runs/${encodeURIComponent(stepRunId)}/rerun`, {}, zStepRunRerunResult);
