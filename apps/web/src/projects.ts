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
import { resealProcess } from './process/seal.js';
import type { Store } from './store/store.js';
import { pickerView, type PickerView } from './views/projets.js';

export interface ProjectsOptions {
  readonly store: Store;
  readonly client: Pick<Client, 'command' | 'query'>;
  /** Seals a Modèle's Commandes again for each Projet (PROCESS-14). */
  readonly vault: Pick<Vault, 'sealItem' | 'openItem'>;
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
 * sealed again for it, from `template:<id>` to `process:<projectId>`.
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
        const sealed = store.getState().slices['process-template']?.get(template)?.sealed ?? null;
        const projects = await Promise.all(
          repositoryIds.map(async (repositoryId) => {
            const id = newId();
            return { repositoryId, id, templateSealed: await resealProcess(vault, sealed, templateSealAad(template), processSealAad(id)) };
          }),
        );
        await followProjects(client, repositoryIds, template, projects);
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
