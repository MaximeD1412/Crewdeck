import type { FolderCheckResult, Project } from '@crewdeck/contracts';
import { folderFormView, type FolderFormView } from '../views/projets.js';
import type { FolderChecker } from './folder-check.js';

/**
 * The FolderProjectForm's page side (PROJET-6): the path's checks, then the
 * Projet created from the folder the Runner checked last, or a Local
 * Projet's folder chosen again. One command at a time, the form `busy`
 * meanwhile; a refusal is thrown, for the page to show.
 */

/** The Runner's states a Projet can be created from: a git repository, or a folder git is not in yet. */
const CREATABLE: ReadonlySet<FolderCheckResult['state']> = new Set(['ready', 'not-git']);

export interface FolderFormOptions {
  readonly checker: FolderChecker;
  /** Creates the Projet from the folder checked (`local.ts`, `createLocalProject`). */
  readonly createProject: (input: { readonly path: string; readonly name: string; readonly templateId: string; readonly check: FolderCheckResult }) => Promise<Project>;
  /** Chooses a Projet's folder again (`local.ts`, `attachFolder`). */
  readonly attachFolder: (projectId: string, path: string) => Promise<Project>;
}

export interface FolderFormContext {
  readonly context: FolderFormView['context'];
  readonly vaultLocked: boolean;
  /** The Runner's machine, `null` without a Runner. */
  readonly machine: string | null;
  /** The name proposed before any check (the Projet's, when choosing its folder again). */
  readonly name?: string;
}

export interface FolderForm {
  view(context: FolderFormContext): FolderFormView;
  /** A keystroke in « Chemin du dossier »; `projectId` while choosing that Projet's folder again. */
  checkPath(path: string, projectId?: string): void;
  /** Whether the Runner is online (`FolderChecker.runner`). */
  runner(online: boolean): void;
  /** Creates the Projet from `path`, when it is the path the Runner checked last and a Projet can be made of it; `null` otherwise. */
  create(input: { readonly path: string; readonly name: string; readonly templateId: string }): Promise<Project | null>;
  /** Chooses `projectId`'s folder again, on the same condition. */
  attach(projectId: string, path: string): Promise<Project | null>;
  /** Forgets the path, its check and what is on its way (a new page, another Projet). */
  reset(): void;
  subscribe(fn: () => void): () => void;
}

export const createFolderForm = ({ checker, createProject, attachFolder }: FolderFormOptions): FolderForm => {
  const listeners = new Set<() => void>();
  let busy = false;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  checker.subscribe(notify);

  /** The check of `path` when a Projet can be made of it. */
  const checked = (path: string): FolderCheckResult | null => {
    const { path: typed, result } = checker.state();
    return typed === path && result && CREATABLE.has(result.state) ? result : null;
  };

  const run = async <T>(command: () => Promise<T>): Promise<T> => {
    busy = true;
    notify();
    try {
      const done = await command();
      checker.reset();
      return done;
    } finally {
      busy = false;
      notify();
    }
  };

  return {
    view({ context, vaultLocked, machine, name = '' }) {
      const { path, check, result } = checker.state();
      return folderFormView({ context, path, check, name: context === 'repick' ? name : (result?.name ?? name), busy, vaultLocked, machine });
    },
    checkPath: (path, projectId) => checker.type(path, projectId),
    runner: (online) => checker.runner(online),
    async create({ path, name, templateId }) {
      const check = checked(path);
      if (busy || !check) return null;
      return run(() => createProject({ path, name: name.trim(), templateId, check }));
    },
    async attach(projectId, path) {
      if (busy || !checked(path)) return null;
      return run(() => attachFolder(projectId, path));
    },
    reset: () => checker.reset(),
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
