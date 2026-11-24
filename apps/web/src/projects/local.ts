import {
  processSealAad,
  projectFolderAad,
  projectNameAad,
  templateSealAad,
  type FolderCheckResult,
  type ProcessTemplateId,
  type Project,
  type SealedItem,
} from '@crewdeck/contracts';
import type { Client } from '../api/client.js';
import { postLocalProject, postProjectFolder } from '../api/projects.js';
import { uuidv7 } from '../ids.js';
import { utf8 } from '../keys/bytes.js';
import { sealedWrite } from '../keys/sealed-write.js';
import type { Vault } from '../keys/vault.js';
import { resealProcess } from '../process/seal.js';
import { toWire } from './folder-check.js';

/**
 * A Local Projet's commands (PROJET-6, ADR 0012, ADR 0003): its id drawn
 * here, so that its name is sealed under `project:<id>:name` and its path
 * under `project:<id>:folder` before the server sees them; the path is for
 * the Runner only, as JSON `{ path }`. Each write carries the version of the
 * vault key it was sealed under, and is sealed again once after a rotation
 * (409 `vault.version-changed`, E2E-4).
 */

export interface LocalProjectDeps {
  readonly client: Pick<Client, 'command'>;
  readonly vault: Pick<Vault, 'sealItem' | 'openItem' | 'unlockVault'>;
  /** A new Projet's id: a UUIDv7 drawn here by default. */
  readonly newId?: () => string;
}

export interface NewLocalProject {
  readonly path: string;
  readonly name: string;
  readonly templateId: ProcessTemplateId;
  /** The sealed part of the Pilote's Modèle `templateId` (its Commandes, under `template:<templateId>`), `null` without one (PROCESS-14). */
  readonly templateSealed?: SealedItem | null;
  /** The revision of that Modèle whose part `templateSealed` is: the server refuses it replaced since (409 `process-template.changed`). */
  readonly templateRevision?: number;
  /** The Runner's check of `path`: whether it has code, its branch. */
  readonly check: FolderCheckResult;
}

const sealFolder = (vault: Pick<Vault, 'sealItem'>, projectId: string, path: string) => vault.sealItem(utf8(JSON.stringify({ path })), utf8(projectFolderAad(projectId)));

/**
 * Creates the Projet: `hasCode` and `releaseBranch` the check's; a Modèle's
 * Commandes sealed again for it, under `process:<id>` (PROCESS-14). A
 * refusal is an `ApiError`.
 */
export const createLocalProject = async (
  { client, vault, newId = () => uuidv7() }: LocalProjectDeps,
  { path, name, templateId, templateRevision, templateSealed = null, check }: NewLocalProject,
): Promise<Project> => {
  const id = newId();
  return sealedWrite(vault, async () => {
    const [nameSealed, folderSealed, processSealed] = await Promise.all([
      vault.sealItem(utf8(name), utf8(projectNameAad(id))),
      sealFolder(vault, id, path),
      resealProcess(vault, templateSealed, templateSealAad(templateId), processSealAad(id)),
    ]);
    return postLocalProject(client, {
      id,
      nameSealed: toWire(nameSealed),
      folderSealed: toWire(folderSealed),
      vaultKeyVersion: Math.min(nameSealed.vaultKeyVersion, folderSealed.vaultKeyVersion, processSealed?.vaultKeyVersion ?? Infinity),
      hasCode: check.hasCode,
      releaseBranch: check.branch,
      templateId,
      ...(templateRevision === undefined ? {} : { templateRevision }),
      templateSealed: processSealed?.sealed ?? null,
    });
  });
};

/** Chooses a Local Projet's folder again (`/projets/ajouter?projet=<id>`); `seq` the store's unless given. */
export const attachFolder = async ({ client, vault }: Omit<LocalProjectDeps, 'newId'>, projectId: string, path: string, seq?: bigint): Promise<Project> =>
  sealedWrite(vault, async () => {
    const folderSealed = await sealFolder(vault, projectId, path);
    return postProjectFolder(client, projectId, { folderSealed: toWire(folderSealed), vaultKeyVersion: folderSealed.vaultKeyVersion, ...(seq === undefined ? {} : { seq }) });
  });
