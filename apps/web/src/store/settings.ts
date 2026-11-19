import type { AccountSettings, ProjectSettings, SettingsState } from '@crewdeck/contracts';

/**
 * How `settings.upserted` changes the `settings` slice (PARAM-3): the
 * account's Paramètres replace the account's, each Projet's kept; one
 * Projet's (`{ projectSettings }`) replace that Projet's, or join the others.
 * Before any snapshot there is nothing to change.
 */
export const applySettingsEvent = (current: unknown, payload: unknown): SettingsState | null => {
  const settings = current as SettingsState | null;
  const event = payload as AccountSettings | { projectSettings: ProjectSettings };
  if (!('projectSettings' in event)) return { ...event, projects: settings?.projects ?? [] };
  if (!settings) return null;
  const { projectSettings } = event;
  const others = settings.projects.filter((project) => project.projectId !== projectSettings.projectId);
  const index = settings.projects.findIndex((project) => project.projectId === projectSettings.projectId);
  const projects = index === -1 ? [...others, projectSettings] : settings.projects.map((project, i) => (i === index ? projectSettings : project));
  return { ...settings, projects };
};
