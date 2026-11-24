import {
  isOwnProcessTemplate,
  processSealAad,
  projectNameAad,
  templateSealAad,
  zProcessTemplateId,
  zPublicConfig,
  type InstallReturn,
  type Project,
  type PublicConfig,
} from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { followProjects, installUrl } from './api/projects.js';
import { uuidv7 } from './ids.js';
import { fromBase64Url, utf8 } from './keys/bytes.js';
import type { Vault, VaultState } from './keys/vault.js';
import { sealedWrite } from './keys/sealed-write.js';
import { withOpenedProcess } from './process/seal.js';
import type { Store } from './store/store.js';
import { pickerView, type PickerView } from './views/projets.js';

export interface ProjectsOptions {
  readonly store: Store;
  readonly client: Pick<Client, 'command' | 'query'>;
  /** Seals a Modèle's Commandes again for each Projet (PROCESS-14), unlocked again after a rotation. */
  readonly vault: Pick<Vault, 'sealItem' | 'openItem' | 'unlockVault'>;
  /** A new Projet's id: a UUIDv7 drawn here by default. */
  readonly newId?: () => string;
}

export interface Projects {
  /** The RepositoryPicker's data for `context`; the first call reads `GET /api/config` for GitHub's installation page. */
  picker(context: InstallReturn): PickerView;
  /** Follows the Dépôts GitHub with the Modèle de process chosen, the picker busy meanwhile; a refusal is thrown, for the page to show. */
  follow(repositoryIds: readonly string[], templateId: string): Promise<void>;
  /** Calls `fn` after each change of the page's own state; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

/**
 * The page's side of the Dépôts GitHub (PROJET-2): the store's `repository`
 * slice for the picker, GitHub's installation page from the config, and the
 * follow command, one at a time. From one of the Pilote's Modèles
 * (PROCESS-14), each Projet's id is drawn here, and the Modèle's Commandes
 * sealed again for it, from `template:<id>` to `process:<projectId>`,
 * with the Modèle's revision and the vault key's version (sealed again
 * once after a rotation).
 */
export const createProjects = ({ store, client, vault, newId = () => uuidv7() }: ProjectsOptions): Projects => {
  const listeners = new Set<() => void>();
  let config: PublicConfig | null = null;
  let reading = false;
  let following = false;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const readConfig = () => {
    if (config || reading) return;
    reading = true;
    // A config not read leaves the link out; the next render reads it again.
    void client
      .query('/api/config', zPublicConfig)
      .then((read) => {
        config = read;
        notify();
      })
      .catch(() => undefined)
      .finally(() => {
        reading = false;
      });
  };

  return {
    picker(context) {
      readConfig();
      const { slices, vaultState } = store.getState();
      return pickerView({
        context,
        repositories: slices.repository?.values() ?? [],
        templates: slices['process-template']?.values() ?? [],
        vaultLocked: vaultState !== 'unlocked',
        installUrl: config ? installUrl(config, context) : null,
        busy: following,
      });
    },
    async follow(repositoryIds, templateId) {
      if (following) return;
      const template = zProcessTemplateId.parse(templateId);
      following = true;
      notify();
      try {
        if (!isOwnProcessTemplate(template)) {
          await followProjects(client, repositoryIds, template);
          return;
        }
        const own = store.getState().slices['process-template']?.get(template);
        if (!own) throw new Error(`projects: no Modèle de process ${template}`);
        const ids = repositoryIds.map((repositoryId) => ({ repositoryId, id: newId() }));
        // Opened once under the key held now; each attempt seals it again, under the new key after a rotation.
        await withOpenedProcess(vault, own.sealed, templateSealAad(template), (sealUnder) =>
          sealedWrite(vault, async () => {
            const projects = await Promise.all(ids.map(async ({ repositoryId, id }) => ({ repositoryId, id, resealed: await sealUnder(processSealAad(id)) })));
            const versions = projects.flatMap(({ resealed }) => (resealed ? [resealed.vaultKeyVersion] : []));
            await followProjects(client, repositoryIds, template, {
              templateRevision: own.revision,
              projects: projects.map(({ repositoryId, id, resealed }) => ({ repositoryId, id, templateSealed: resealed?.sealed ?? null })),
              ...(versions.length > 0 ? { vaultKeyVersion: Math.min(...versions) } : {}),
            });
          }),
        );
      } finally {
        following = false;
        notify();
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};

export interface ProjectNames {
  /** A Projet's name: its `displayName`, else its sealed name opened, else « Projet local » (the vault locked, opening, or not this vault's). */
  projectName(project: Pick<Project, 'id' | 'displayName' | 'nameSealed'>): string;
  /** Calls `fn` when a name opened; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * The Local Projets' names in clear (PROJET-6, ADR 0003), in this page's
 * memory only: each opened once with the vault key under
 * `project:<id>:name`, asynchronously, and kept by its Projet's id,
 * ciphertext and item key, as the Idées' texts are (`store/idea-plaintext.ts`):
 * a rotation of the vault key rewraps the key alone (E2E-4), and a name that
 * did not open under the old one is opened again under the new.
 */
export const createProjectNames = ({ vault, vaultState }: { readonly vault: Pick<Vault, 'openItem'>; readonly vaultState: () => VaultState }): ProjectNames => {
  const opened = new Map<string, { readonly ciphertext: string; readonly key: string; name: string | null }>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const open = (id: string, sealed: NonNullable<Project['nameSealed']>) => {
    const entry: { readonly ciphertext: string; readonly key: string; name: string | null } = { ciphertext: sealed.ciphertext, key: sealed.key, name: null };
    opened.set(id, entry);
    void (async () => {
      try {
        const item = { key: fromBase64Url(sealed.key), ciphertext: fromBase64Url(sealed.ciphertext) };
        entry.name = decoder.decode(await vault.openItem(item, utf8(projectNameAad(id))));
        notify();
      } catch {
        // Locked meanwhile: tried again once it opens; otherwise it is not this vault's, and stays « Projet local ».
        if (vaultState() !== 'unlocked') opened.delete(id);
      }
    })();
  };

  return {
    projectName(project) {
      if (project.displayName !== null) return project.displayName;
      const fallback = t('projets.local.fallbackName');
      if (project.nameSealed === null || vaultState() !== 'unlocked') return fallback;
      const entry = opened.get(project.id);
      if (entry?.ciphertext !== project.nameSealed.ciphertext || entry.key !== project.nameSealed.key) {
        open(project.id, project.nameSealed);
        return fallback;
      }
      return entry.name ?? fallback;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
