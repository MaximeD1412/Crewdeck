import { type StepRun, zStepRun } from '../api/phase-runs.js';
import { registerEventPayload } from './index.js';

/** `step-run.upserted`: the StepRun, when started and on each change of its state, outputs or Verdict (PROCESS-4). */
export const zStepRunEventPayload = registerEventPayload('step-run', zStepRun);

declare module './index.js' {
  interface EventPayloads {
    'step-run': StepRun;
  }
}
