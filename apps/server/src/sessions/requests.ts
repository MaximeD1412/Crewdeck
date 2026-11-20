import { DECISION_LABEL_MAX, type DecisionKind, type SessionRequestKind, type SessionWaiting } from '@crewdeck/contracts';
import type { DecisionsService, RaiseInput } from '../decisions/decisions.service.js';
import type { Tx } from '../realtime/transactions.js';

/**
 * The requests of a Session (SESSION-3): a `question` or a
 * `permission-request` of its agent waits for the Pilote, a Décision of
 * « À toi » per request (`subjectId` its requestId). The server knows that it
 * waits and the seq of its event in the Session's log, never its text nor its
 * command (ADR 0003): the page reads them from the Runner, through the relay.
 */

export const REQUEST_SUBJECT_TYPE = 'session-request';

export const REQUEST_DECISION_KINDS = ['agent-question', 'permission-requested'] as const satisfies readonly DecisionKind[];

export const requestDecisionKind = (kind: SessionRequestKind): (typeof REQUEST_DECISION_KINDS)[number] =>
  kind === 'question' ? 'agent-question' : 'permission-requested';

/** What the Décision of a request reads of its Session: all of it readable by the server. */
export interface RequestSession {
  readonly id: string;
  /** Null for a Session of no Projet (an Idée's analysis, IDEE-2). */
  readonly projectId: string | null;
  readonly role: string;
  /** Null for a Local Projet's, whose title the server cannot read (SOURCE-2). */
  readonly title: string | null;
  readonly projectName: string | null;
}

/** The label of a Local Projet's Session's request, its title sealed. */
export const LOCAL_SESSION_LABEL = 'Session d’un Projet local';

/** The Décision of the request `message` of `session`: its title the Session's, its link the panel's. */
export const requestDecision = (session: RequestSession, message: Pick<SessionWaiting, 'requestId' | 'kind' | 'seq'>): RaiseInput => ({
  kind: requestDecisionKind(message.kind),
  projectId: session.projectId,
  projectName: session.projectName,
  subjectType: REQUEST_SUBJECT_TYPE,
  subjectId: message.requestId,
  label: (session.title ?? LOCAL_SESSION_LABEL).slice(0, DECISION_LABEL_MAX),
  metaParts: ['session'],
  tone: message.kind === 'question' ? 'accent' : 'caution',
  link: `/a-toi?session=${session.id}`,
  params: { sessionId: session.id, requestSeq: message.seq, role: session.role },
});

/** The open Décisions of the Session's requests. */
const openRequests = (tx: Tx, sessionId: string) =>
  tx.decision.findMany({
    where: { kind: { in: [...REQUEST_DECISION_KINDS] }, state: 'open', params: { path: ['sessionId'], equals: sessionId } },
    select: { kind: true, subjectId: true },
  });

/** Raises the Décision of the request waiting in `session`, with `tx`. */
export const raiseRequest = async (tx: Tx, decisions: Pick<DecisionsService, 'raise'>, session: RequestSession, message: SessionWaiting): Promise<void> => {
  await decisions.raise(tx, requestDecision(session, message));
};

/** Resolves the Décision of the request answered, with `tx`; whether another request of the Session still waits. */
export const resolveRequest = async (tx: Tx, decisions: Pick<DecisionsService, 'resolve'>, sessionId: string, requestId: string): Promise<boolean> => {
  for (const kind of REQUEST_DECISION_KINDS) await decisions.resolve(tx, kind, requestId, 'answered');
  return (await openRequests(tx, sessionId)).length > 0;
};

/**
 * Resolves the Décisions of every request of a Session left open: `ended`, it
 * ended and no Moteur is left to take their answer; `withdrawn`, it resumed,
 * and the new run never takes the requests of the turn a stop cut.
 */
export const resolveOpenRequests = async (tx: Tx, decisions: Pick<DecisionsService, 'resolve'>, sessionId: string, outcome: 'ended' | 'withdrawn'): Promise<void> => {
  for (const { kind, subjectId } of await openRequests(tx, sessionId)) await decisions.resolve(tx, kind as DecisionKind, subjectId, outcome);
};
