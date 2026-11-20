import { z } from 'zod';
import { withSeq } from './commands.js';
import { zStepRun } from './phase-runs.js';

/**
 * `POST /api/step-runs/:id/rerun` (ATOI-2): « Relancer l'Étape » on a
 * StepRun `failed` by its Contrat or its Session, the Décision « Contrat
 * incomplet » or « Étape échouée » it raised answered. The body is the `seq`
 * of the StepRun the page showed.
 */
export const zStepRunRerun = withSeq(z.object({}));
export type StepRunRerun = z.infer<typeof zStepRunRerun>;

/**
 * Its answer: the new StepRun of the same Étape and iteration, or `null`
 * while the start guard of its Phase holds it (a Boucle at its limit): the
 * Étape then starts as soon as it may, its `step-run.upserted` telling it.
 */
export const zStepRunRerunResult = z.object({ stepRun: zStepRun.nullable() });
export type StepRunRerunResult = z.infer<typeof zStepRunRerunResult>;
