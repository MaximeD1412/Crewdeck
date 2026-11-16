import { type AgentSession, zAgentSession } from '../api/sessions.js';
import { registerEventPayload } from './index.js';

/** `agent-session.upserted`: the Session, when created and on each change of its state (RUNNER-9). */
export const zAgentSessionEventPayload = registerEventPayload('agent-session', zAgentSession);

declare module './index.js' {
  interface EventPayloads {
    'agent-session': AgentSession;
  }
}
