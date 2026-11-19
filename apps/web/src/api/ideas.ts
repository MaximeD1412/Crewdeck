import { IDEA_CLOSED_STATES, zIdea, zIdeaList, type Idea, type IdeaList, type NoteIdeaInput } from '@crewdeck/contracts';
import type { Client } from './client.js';

/**
 * `POST /api/ideas` (IDEE-1): an Idée noted, its text sealed by the page
 * under `ideaItemAad(id, 'text')`. The answer is the Idée `to-triage`, whose
 * `idea.upserted` the store gets too. A refusal is an `ApiError` (400 its
 * fields, 404 a Projet gone, 409 stale or an id already taken).
 */
export const noteIdea = (client: Pick<Client, 'command'>, body: Omit<NoteIdeaInput, 'seq'>): Promise<Idea> =>
  client.command('POST', '/api/ideas', body, zIdea);

/**
 * `GET /api/ideas?states=merged,rejected`: the Idées merged or rejected, the
 * last updated first, 50 a page: those older than the `ideas` slice's 90
 * days come from here.
 */
export const listClosedIdeas = (client: Pick<Client, 'query'>, cursor?: string): Promise<IdeaList> =>
  client.query(`/api/ideas?states=${IDEA_CLOSED_STATES.join(',')}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, zIdeaList);
