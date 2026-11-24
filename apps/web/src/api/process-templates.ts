import { type ProcessTemplate, type RenameProcessTemplateInput, type SaveProcessTemplateInput, zProcessTemplate } from '@crewdeck/contracts';
import type { Client } from './client.js';

/**
 * `POST /api/process-templates` (PROCESS-14): a Projet's active version saved
 * as the Modèle `id` the page drew, its sealed part under `template:<id>`;
 * `replace` overwrites the Modèle of the same name. A refusal is an
 * `ApiError`: 409 `process-template.name-taken` (on `fields.name`) or
 * `process.version-stale`, 422 `process-template.name-reserved`,
 * `process-template.sealed-mismatch` or `process-template.too-many`.
 */
export const saveProcessTemplate = (client: Pick<Client, 'command'>, input: SaveProcessTemplateInput): Promise<ProcessTemplate> =>
  client.command('POST', '/api/process-templates', input, zProcessTemplate);

/** `PATCH /api/process-templates/:id`: the Modèle renamed, the same name rules (409 on `fields.name`); 404 once it is gone. */
export const renameProcessTemplate = (client: Pick<Client, 'command'>, id: string, input: RenameProcessTemplateInput): Promise<ProcessTemplate> =>
  client.command('PATCH', `/api/process-templates/${encodeURIComponent(id)}`, input, zProcessTemplate);

/** `DELETE /api/process-templates/:id`: 204; the Projets started from it keep their Process. */
export const removeProcessTemplate = (client: Pick<Client, 'command'>, id: string): Promise<void> =>
  client.command('DELETE', `/api/process-templates/${encodeURIComponent(id)}`, {});
