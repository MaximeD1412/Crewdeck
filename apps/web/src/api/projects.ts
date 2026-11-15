import { zProjectList, type InstallReturn, type Project, type PublicConfig } from '@crewdeck/contracts';
import type { Client } from './client.js';

/**
 * `POST /api/projects` (US-3): the Dépôts GitHub to follow, each becoming a
 * Projet; the answer is the Projets created, whose events the store gets too.
 * A refusal is an `ApiError` (404 a repository gone, 422 already a Projet).
 */
export const followProjects = async (client: Pick<Client, 'command'>, repositoryIds: readonly string[]): Promise<Project[]> =>
  (await client.command('POST', '/api/projects', { repositoryIds }, zProjectList)).items;

/**
 * GitHub's page that installs the App on more repositories (ADR 0002); its
 * `state` is where the App's Setup URL (`GET /api/github/setup`) brings the
 * Pilote back.
 */
export const installUrl = (config: Pick<PublicConfig, 'githubWebUrl' | 'appSlug'>, back: InstallReturn): string =>
  `${config.githubWebUrl.replace(/\/+$/, '')}/apps/${encodeURIComponent(config.appSlug)}/installations/new?state=${back}`;
