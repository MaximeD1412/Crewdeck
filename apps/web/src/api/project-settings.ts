import { zProjectSettings, type ProjectSettings, type ProjectSettingsPatch } from '@crewdeck/contracts';
import type { Client } from './client.js';

/** Changes the Paramètres of a Projet (`PATCH /api/projects/:id/settings`): its settings after it. */
export const updateProjectSettings = (client: Pick<Client, 'command'>, projectId: string, patch: ProjectSettingsPatch): Promise<ProjectSettings> =>
  client.command('PATCH', `/api/projects/${encodeURIComponent(projectId)}/settings`, patch, zProjectSettings);
