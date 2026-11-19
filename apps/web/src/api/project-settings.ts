import { zProjectSettingsUpdated, type ProjectSettingsPatch, type ProjectSettingsUpdated } from '@crewdeck/contracts';
import type { Client } from './client.js';

/** Changes the Paramètres of a Projet (`PATCH /api/projects/:id/settings`): its settings after it, and the `seq` of their event. */
export const updateProjectSettings = (client: Pick<Client, 'command'>, projectId: string, patch: ProjectSettingsPatch): Promise<ProjectSettingsUpdated> =>
  client.command('PATCH', `/api/projects/${encodeURIComponent(projectId)}/settings`, patch, zProjectSettingsUpdated);
