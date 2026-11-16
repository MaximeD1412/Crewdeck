import { zAccountSettings, type AccountSettings, type CreateRole } from '@crewdeck/contracts';
import type { Client } from './client.js';

/**
 * Adds a Rôle (`POST /api/roles`, PARAM-2): the settings after it, whose
 * `settings.upserted` the store gets too. A refusal is an `ApiError` (409 a
 * name taken on `fields.name`, 422 past 20 Rôles or a model not usable on
 * `fields.model`).
 */
export const createRole = (client: Pick<Client, 'command'>, body: CreateRole): Promise<AccountSettings> =>
  client.command('POST', '/api/roles', body, zAccountSettings);

/** Removes a Rôle the Pilote added (`DELETE /api/roles/:id`): the settings after it; 409 while an Étape names it. */
export const removeRole = (client: Pick<Client, 'command'>, roleId: string): Promise<AccountSettings> =>
  client.command('DELETE', `/api/roles/${encodeURIComponent(roleId)}`, {}, zAccountSettings);
