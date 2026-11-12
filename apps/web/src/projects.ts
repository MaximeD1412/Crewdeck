import { zPublicConfig, type InstallReturn, type PublicConfig } from '@crewdeck/contracts';
import type { Client } from './api/client.js';
import { followProjects, installUrl } from './api/projects.js';
import type { Store } from './store/store.js';
import { pickerView, type PickerView } from './views/projets.js';

export interface ProjectsOptions {
  readonly store: Store;
  readonly client: Pick<Client, 'command' | 'query'>;
}

export interface Projects {
  /** The RepositoryPicker's data for `context`; the first call reads `GET /api/config` for GitHub's installation page. */
  picker(context: InstallReturn): PickerView;
  /** Follows the Dépôts GitHub, the picker busy meanwhile; a refusal is thrown, for the page to show. */
  follow(repositoryIds: readonly string[]): Promise<void>;
  /** Calls `fn` after each change of the page's own state; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

/**
 * The page's side of the Dépôts GitHub (PROJET-2): the store's `repository`
 * slice for the picker, GitHub's installation page from the config, and the
 * follow command, one at a time.
 */
export const createProjects = ({ store, client }: ProjectsOptions): Projects => {
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
      return pickerView({
        context,
        repositories: store.getState().slices.repository?.values() ?? [],
        installUrl: config ? installUrl(config, context) : null,
        busy: following,
      });
    },
    async follow(repositoryIds) {
      if (following) return;
      following = true;
      notify();
      try {
        await followProjects(client, repositoryIds);
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
