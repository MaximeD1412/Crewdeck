import { type Decision, zDecision } from '../api/decisions.js';
import { registerEventPayload } from './index.js';

/** `decision.upserted`: the Décision as `GET /api/decisions` returns it, when raised or updated; `decision.removed` once resolved. */
export const zDecisionEventPayload = registerEventPayload('decision', zDecision);

declare module './index.js' {
  interface EventPayloads {
    decision: Decision;
  }
}
