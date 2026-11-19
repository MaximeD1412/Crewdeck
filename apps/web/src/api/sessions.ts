import { type AgentSession, zAgentSession } from '@crewdeck/contracts';
import type { Client } from './client.js';

const path = (id: string, action?: 'stop' | 'resume'): string => `/api/sessions/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

/** `GET /api/sessions/:id`: one of the Pilote's Sessions; another's, or none, is an `ApiError` 404. */
export const getSession = (client: Pick<Client, 'query'>, id: string): Promise<AgentSession> => client.query(path(id), zAgentSession);

/** `POST /api/sessions/:id/stop` (RUNNER-9): « Arrêter », the Session `stopped`. */
export const stopSession = (client: Pick<Client, 'command'>, id: string): Promise<AgentSession> =>
  client.command('POST', path(id, 'stop'), {}, zAgentSession);

/** `POST /api/sessions/:id/resume` (RUNNER-9): « Reprendre », the Session `starting` again. */
export const resumeSession = (client: Pick<Client, 'command'>, id: string): Promise<AgentSession> =>
  client.command('POST', path(id, 'resume'), {}, zAgentSession);
