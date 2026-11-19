import type { Decision, EngineEvent } from '@crewdeck/contracts';
import type { DecisionAction, DecisionReads } from './registry.js';

/**
 * What the Décisions of a Session's request share (SESSION-3): the Session
 * and the `seq` of the request's event, in their params; the text of the
 * request read from the Runner, never from the Décision (ADR 0003).
 */

const text = (decision: Pick<Decision, 'params'>, name: string): string | null => {
  const value = decision.params[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

export const sessionOf = (decision: Pick<Decision, 'params'>): string | null => text(decision, 'sessionId');

export const roleOf = (decision: Pick<Decision, 'params'>): string | null => text(decision, 'role');

/** The request's event, read from the Runner: `undefined` while it is read, `null` when it cannot be. */
export const requestEvent = <K extends 'question' | 'permission-request'>(
  decision: Pick<Decision, 'params' | 'subjectId'>,
  kind: K,
  reads: DecisionReads,
): Extract<EngineEvent, { kind: K }> | null | undefined => {
  const sessionId = sessionOf(decision);
  const seq = decision.params['requestSeq'];
  if (sessionId === null || typeof seq !== 'number' || !reads.runnerOnline) return null;
  const read = reads.sessionEvent(sessionId, seq);
  if (read.state === 'reading') return undefined;
  if (read.state === 'unavailable') return null;
  const { event } = read;
  return event.kind === kind && 'requestId' in event && event.requestId === decision.subjectId
    ? (event as Extract<EngineEvent, { kind: K }>)
    : null;
};

/** The Session's panel over « À toi », where the request is answered; the Décision's link without a Session. */
export const openSessionPanel: DecisionAction['run'] = (decision, { navigate }) => {
  const sessionId = sessionOf(decision);
  navigate(sessionId === null ? decision.link : `/a-toi?session=${encodeURIComponent(sessionId)}`);
};
