import {
  zProject,
  zProjectList,
  type AttachProjectFolder,
  type CreateLocalProject,
  type FollowedProject,
  type InstallReturn,
  type ProcessTemplateId,
  type Project,
  type PublicConfig,
} from '@crewdeck/contracts';
import type { Client } from './client.js';

/**
 * `POST /api/projects` (US-3): the Dépôts GitHub to follow, each becoming a
 * Projet started from the Modèle de process `templateId` (US-97); the answer
 * is the Projets created, whose events the store gets too. A refusal is an
 * `ApiError` (404 a repository gone, 422 already a Projet). `own`, with
 * one of the Pilote's Modèles: each Projet's id drawn by the page, its
 * Commandes sealed again for it (PROCESS-14).
 */
export const followProjects = async (
  client: Pick<Client, 'command'>,
  repositoryIds: readonly string[],
  templateId: ProcessTemplateId,
  own?: OwnTemplateFollow,
): Promise<Project[]> => (await client.command('POST', '/api/projects', { repositoryIds, templateId, ...own }, zProjectList)).items;

/**
 * What a follow from one of the Pilote's Modèles adds (PROCESS-14): the
 * revision of the Modèle whose part the page sealed again (409
 * `process-template.changed` once replaced), each Projet's id and part,
 * and, with a part, the vault key's version it was sealed under (409
 * `vault.version-changed` after a rotation).
 */
export interface OwnTemplateFollow {
  readonly templateRevision: number;
  readonly projects: readonly FollowedProject[];
  readonly vaultKeyVersion?: number;
}

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
 * GitHub's page that installs the App on more repositories (ADR 0002); its
 * `state` is where the App's Setup URL (`GET /api/github/setup`) brings the
 * Pilote back.
 */
export const installUrl = (config: Pick<PublicConfig, 'githubWebUrl' | 'appSlug'>, back: InstallReturn): string =>
  `${config.githubWebUrl.replace(/\/+$/, '')}/apps/${encodeURIComponent(config.appSlug)}/installations/new?state=${back}`;
