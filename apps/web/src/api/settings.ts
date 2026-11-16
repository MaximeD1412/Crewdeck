import { zAccountSettings, type AccountSettings, type AccountSettingsPatch } from '@crewdeck/contracts';
import type { Client } from './client.js';

/** Changes the Paramètres of the account (`PATCH /api/settings`): the settings after it. */
export const updateSettings = (client: Pick<Client, 'command'>, patch: AccountSettingsPatch): Promise<AccountSettings> =>
  client.command('PATCH', '/api/settings', patch, zAccountSettings);
