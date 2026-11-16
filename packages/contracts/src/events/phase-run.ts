import { type PhaseRun, zPhaseRun } from '../api/phase-runs.js';
import { registerEventPayload } from './index.js';

/** `phase-run.upserted`: the PhaseRun, when admitted and on each change of its state (PROCESS-4). */
export const zPhaseRunEventPayload = registerEventPayload('phase-run', zPhaseRun);

declare module './index.js' {
  interface EventPayloads {
    'phase-run': PhaseRun;
  }
}
