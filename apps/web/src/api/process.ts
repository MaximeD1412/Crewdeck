import { type ProcessDraftInput, type ProjectProcess, zProjectProcess } from '@crewdeck/contracts';
import type { Client } from './client.js';

/** `GET /api/projects/:id/process`: a Projet's Process; the page reads it from the store's `process` slice, this is for a page without it. */
export const getProcess = (client: Pick<Client, 'query'>, projectId: string): Promise<ProjectProcess> =>
  client.query(`/api/projects/${encodeURIComponent(projectId)}/process`, zProjectProcess);

/**
 * `PUT /api/projects/:id/process/draft` (ADR 0011): the whole draft, saved on
 * every change of the canvas, with the `revision` it was based on (`0` the
 * first time) and its version. A refusal is an `ApiError`: 409
 * `process.draft-stale` (another tab saved first, the page reloads the
 * view), 422 `process.invalid` with each refused block in `fields`.
 */
export const saveDraft = (client: Pick<Client, 'command'>, projectId: string, input: ProcessDraftInput): Promise<ProjectProcess> =>
  client.command('PUT', `/api/projects/${encodeURIComponent(projectId)}/process/draft`, input, zProjectProcess);

/**
 * `POST /api/projects/:id/process/activate`, the Action sensible
 * `process.activate` (ADR 0011): the draft's `revision` the dialog showed, and
 * its `seq`; answers the view, its new version active and no draft. A refusal
 * is an `ApiError`: 409 `process.no-draft`, `process.draft-stale` or
 * `sensitive-action.stale`, 422 `process.has-gaps`, `process.invalid` or
 * `process.no-change`.
 */
export const activateProcess = (client: Pick<Client, 'command'>, projectId: string, input: { readonly revision: number; readonly seq: bigint }): Promise<ProjectProcess> =>
  client.command('POST', `/api/projects/${encodeURIComponent(projectId)}/process/activate`, input, zProjectProcess);
