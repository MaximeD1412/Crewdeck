import type { FolderCheckResult, Project, Repository, SourceGroup, SourceKind, SourceMigrationTarget } from '@crewdeck/contracts';
import { t, type MessageKey } from '@crewdeck/sdk';
import type { ConfirmField, ConfirmFormView } from '../dialogs/confirm.js';
import type { FolderChecker } from '../projects/folder-check.js';
import type { StoreState } from '../store/store.js';
import type { MigrationContext } from '../views/source-migration.js';

/**
 * The new place of a migration (SOURCE-9, ADR 0012 « Moving a Source »),
 * picked in its dialog when the Projet has none on the Source it goes to: a
 * repository of the installation that no Projet follows (the Pilote creates
 * it and installs the App on it), or a folder of the Runner's machine,
 * checked live as at a Local Projet's creation (PROJET-6) and sent sealed to
 * the Runner once confirmed.
 */

export interface MigrationPlaceDeps {
  /** A live check of a typed path (PROJET-6's), one per dialog. */
  readonly checker: () => FolderChecker;
  /** Seals `path` as the Projet's folder for the Runner, and sends it as the group's (`projects/local.ts`, `pickSourceFolder`). */
  readonly pickFolder: (projectId: string, group: SourceGroup, path: string) => Promise<void>;
  /** GitHub's page installing the App on more repositories; `null` until known. */
  readonly installUrl: () => string | null;
  /** Where « Relier GitHub » goes, back to the page. */
  readonly linkGithubHref: () => string;
  /** The store, read live: the repositories arriving while the dialog is open, the vault, the Runner's machine. */
  readonly state: () => Pick<StoreState, 'slices' | 'vaultState'>;
  readonly subscribe: (fn: () => void) => () => void;
}

export interface MigrationPlace {
  /** The dialog's fields, and whether the place is picked. */
  view(): Omit<ConfirmFormView, 'consequences'>;
  change(name: string, value: string): void;
  subscribe(fn: () => void): () => void;
  /** What the dialog's sentences name: the repository picked, the folder typed. */
  context(): Pick<MigrationContext, 'repository' | 'folder'>;
  /** Once confirmed: the folder sent to the Runner first, then the target the migration names. */
  commit(): Promise<SourceMigrationTarget>;
  /** Forgets the path and stops following the store. */
  dispose(): void;
}

/** Whether the Projet has no place on `to` yet: no repository, or no folder. */
export const needsPlace = (project: Pick<Project, 'repositoryId' | 'folder'>, to: SourceKind): boolean =>
  to === 'github' ? project.repositoryId === null : project.folder === null;

const collator = new Intl.Collator('fr');

/** The repositories a migration may go to: not followed by any Projet, by name. */
const freeRepositories = (repositories: Iterable<Repository>): Repository[] =>
  [...repositories].filter((repository) => !repository.followed).sort((a, b) => collator.compare(a.fullName, b.fullName));

/**
 * The checks a folder for `group` passes, the Runner's own (`Result.Pickable`):
 * for the code, an empty folder; for the Tickets, a git repository's root only,
 * a folder not one yet waiting for the Pilote's git init.
 */
const fits = (group: SourceGroup, result: FolderCheckResult): boolean =>
  group === 'code' ? result.state === 'not-git' && result.empty === true : result.state === 'ready';

/** What the field says of the path: PROJET-6's messages, and the migration's own for a folder that fits or not. */
const folderMessage = (group: SourceGroup, state: string, result: FolderCheckResult | null, machine: string): string => {
  if (result && (result.state === 'not-git' || result.state === 'ready')) {
    if (group === 'code') return t(fits(group, result) ? 'process.sources.migration.pick.folder.empty' : 'process.sources.migration.pick.folder.notEmpty');
    return t(result.state === 'ready' ? 'process.sources.migration.pick.folder.ready' : 'process.sources.migration.pick.folder.notGit');
  }
  return t(`projets.local.check.${state}` as MessageKey, { machine });
};

export const createMigrationPlace = (
  deps: MigrationPlaceDeps,
  { project, group, to }: { readonly project: Pick<Project, 'id'>; readonly group: SourceGroup; readonly to: SourceKind },
): MigrationPlace => {
  let repositoryId = '';
  const checker = to === 'local' ? deps.checker() : null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  // The path's check follows the Runner, as the creation's: gone, nothing to pick; back, checked again.
  const runner = () => checker?.runner(deps.state().slices.runner?.state === 'online');
  runner();
  const stops = [
    deps.subscribe(() => {
      runner();
      notify();
    }),
    checker?.subscribe(notify) ?? (() => undefined),
  ];

  const picked = (): Repository | null => freeRepositories(deps.state().slices.repository?.values() ?? []).find((repository) => repository.id === repositoryId) ?? null;
  /** The path typed, once the Runner said it fits. */
  const folder = (): string | null => {
    const current = checker?.state();
    return current?.result && fits(group, current.result) ? current.path : null;
  };

  const repositoryField = (): ConfirmField => {
    const { slices } = deps.state();
    const install = deps.installUrl();
    const link = install === null ? {} : { link: { href: install, label: t('process.sources.migration.pick.repository.install'), external: true } };
    if (slices.pilot?.githubLinked === false) {
      return { kind: 'empty', title: t('process.sources.migration.pick.github.title'), link: { href: deps.linkGithubHref(), label: t('process.sources.migration.pick.github.link') } };
    }
    const help = t('process.sources.migration.pick.repository.help');
    const free = freeRepositories(slices.repository?.values() ?? []);
    if (free.length === 0) return { kind: 'empty', title: t('process.sources.migration.pick.repository.none'), text: help, ...link };
    return {
      kind: 'select',
      name: 'repository',
      label: t('process.sources.migration.pick.repository'),
      value: picked()?.id ?? '',
      placeholder: t('process.sources.migration.pick.repository.placeholder'),
      options: free.map((repository) => ({ value: repository.id, label: repository.fullName })),
      help,
      ...link,
    };
  };

  const folderField = (current: ReturnType<FolderChecker['state']>): ConfirmField => {
    const { slices, vaultState } = deps.state();
    const base = { kind: 'text', name: 'folder', label: t('process.sources.migration.pick.folder'), value: current.path, placeholder: t('projets.local.path.placeholder') } as const;
    if (vaultState !== 'unlocked') return { ...base, disabled: true, message: t('process.sources.migration.pick.folder.vaultLocked'), invalid: false };
    const machine = slices.runner?.machine ?? t('projets.local.thisMachine');
    const { state } = current.check;
    const invalid = !['idle', 'checking', 'runner-offline', 'timeout'].includes(state) && !(current.result && fits(group, current.result));
    return { ...base, message: folderMessage(group, state, current.result, machine), invalid };
  };

  return {
    view() {
      if (checker) return { fields: [folderField(checker.state())], ready: deps.state().vaultState === 'unlocked' && folder() !== null };
      return { fields: [repositoryField()], ready: picked() !== null };
    },
    change(name, value) {
      if (name === 'repository' && !checker) {
        repositoryId = value;
        notify();
      }
      if (name === 'folder' && checker) checker.type(value);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    context() {
      if (checker) {
        const { path } = checker.state();
        return { folder: path.trim() === '' ? null : path };
      }
      return { repository: picked()?.fullName ?? null };
    },
    async commit() {
      if (!checker) {
        const repository = picked();
        if (!repository) throw new Error('aucun dépôt choisi');
        return { repositoryId: repository.id };
      }
      const path = folder();
      if (path === null) throw new Error('aucun dossier choisi');
      await deps.pickFolder(project.id, group, path);
      return { folder: true };
    },
    dispose() {
      for (const stop of stops) stop();
      listeners.clear();
      checker?.reset();
    },
  };
};
