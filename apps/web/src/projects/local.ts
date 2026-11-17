import { projectFolderAad, projectNameAad, type FolderCheckResult, type ProcessTemplateId, type Project } from '@crewdeck/contracts';
import type { Client } from '../api/client.js';
import { postLocalProject, postProjectFolder } from '../api/projects.js';
import { uuidv7 } from '../ids.js';
import { utf8 } from '../keys/bytes.js';
import type { Vault } from '../keys/vault.js';
import { toWire } from './folder-check.js';

/**
 * A Local Projet's commands (PROJET-6, ADR 0012, ADR 0003): its id drawn
 * here, so that its name is sealed under `project:<id>:name` and its path
 * under `project:<id>:folder` before the server sees them; the path is for
 * the Runner only, as JSON `{ path }`.
 */

export interface LocalProjectDeps {
  readonly client: Pick<Client, 'command'>;
  readonly vault: Pick<Vault, 'sealItem'>;
  /** A new Projet's id: a UUIDv7 drawn here by default. */
  readonly newId?: () => string;
}

export interface NewLocalProject {
  readonly path: string;
  readonly name: string;
  readonly templateId: ProcessTemplateId;
  /** The Runner's check of `path`: whether it has code, its branch. */
  readonly check: FolderCheckResult;
}

const sealFolder = async (vault: Pick<Vault, 'sealItem'>, projectId: string, path: string) =>
  toWire(await vault.sealItem(utf8(JSON.stringify({ path })), utf8(projectFolderAad(projectId))));

/** Creates the Projet: `hasCode` and `releaseBranch` the check's; a refusal is an `ApiError`. */
export const createLocalProject = async ({ client, vault, newId = () => uuidv7() }: LocalProjectDeps, { path, name, templateId, check }: NewLocalProject): Promise<Project> => {
  const id = newId();
  const [nameSealed, folderSealed] = await Promise.all([
    vault.sealItem(utf8(name), utf8(projectNameAad(id))).then(toWire),
    sealFolder(vault, id, path),
  ]);
  return postLocalProject(client, { id, nameSealed, folderSealed, hasCode: check.hasCode, releaseBranch: check.branch, templateId });
};

/** Chooses a Local Projet's folder again (`/projets/ajouter?projet=<id>`); `seq` the store's unless given. */
export const attachFolder = async ({ client, vault }: Omit<LocalProjectDeps, 'newId'>, projectId: string, path: string, seq?: bigint): Promise<Project> =>
  postProjectFolder(client, projectId, { folderSealed: await sealFolder(vault, projectId, path), ...(seq === undefined ? {} : { seq }) });
