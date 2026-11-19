import {
  zProject,
  zProjectList,
  type AttachProjectFolder,
  type CreateLocalProject,
  type InstallReturn,
  type ProcessTemplateId,
  type Project,
  type PublicConfig,
  type ReadinessFixId,
} from '@crewdeck/contracts';
import type { Client } from './client.js';

/**
 * `POST /api/projects` (US-3): the Dépôts GitHub to follow, each becoming a
 * Projet started from the Modèle de process `templateId` (US-97); the answer
 * is the Projets created, whose events the store gets too. A refusal is an
 * `ApiError` (404 a repository gone, 422 already a Projet).
 */
export const followProjects = async (client: Pick<Client, 'command'>, repositoryIds: readonly string[], templateId: ProcessTemplateId): Promise<Project[]> =>
  (await client.command('POST', '/api/projects', { repositoryIds, templateId }, zProjectList)).items;

/**
 * `POST /api/projects/local` (PROJET-6): a Projet from a folder the Runner
 * checked, its name and its path already sealed by the page. A refusal is an
 * `ApiError` (422 `runner.offline`, 422 `project.id-taken`).
 */
export const postLocalProject = (client: Pick<Client, 'command'>, body: CreateLocalProject): Promise<Project> =>
  client.command('POST', '/api/projects/local', body, zProject);

/**
 * `POST /api/projects/:id/folder` (PROJET-6): a Local Projet's folder chosen
 * again, sealed for the Runner; `seq` the store's unless given. A refusal is
 * an `ApiError` (404, 409 stale, 422 `project.not-local`, 422 `runner.offline`).
 */
export const postProjectFolder = (
  client: Pick<Client, 'command'>,
  projectId: string,
  body: Omit<AttachProjectFolder, 'seq'> & { readonly seq?: bigint },
): Promise<Project> => client.command('POST', `/api/projects/${encodeURIComponent(projectId)}/folder`, body, zProject);

/**
 * `POST /api/projects/:id/fixes/:checkId` (PROJET-3): « Corriger » a check
 * of the Projet's readiness where it is made (its labels, its integration
 * branch on GitHub, its folder on the Runner); the answer is the Projet, its
 * readiness recomputed after. A refusal is an `ApiError` (404, 409 stale,
 * 422 `project.fix-unavailable`, 422 `runner.offline`).
 */
export const postProjectFix = (client: Pick<Client, 'command'>, projectId: string, checkId: ReadinessFixId): Promise<Project> =>
  client.command('POST', `/api/projects/${encodeURIComponent(projectId)}/fixes/${encodeURIComponent(checkId)}`, {}, zProject);

/**
 * GitHub's page that installs the App on more repositories (ADR 0002); its
 * `state` is where the App's Setup URL (`GET /api/github/setup`) brings the
 * Pilote back.
 */
export const installUrl = (config: Pick<PublicConfig, 'githubWebUrl' | 'appSlug'>, back: InstallReturn): string =>
  `${config.githubWebUrl.replace(/\/+$/, '')}/apps/${encodeURIComponent(config.appSlug)}/installations/new?state=${back}`;
