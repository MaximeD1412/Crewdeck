import {
  worktreeCommandsAad,
  zWorktreeCommands,
  type ProjectSettingsPatch,
  type SealedItem,
  type WorktreeCommands,
} from '@crewdeck/contracts';
import type { Client } from './api/client.js';
import { updateProjectSettings } from './api/project-settings.js';
import { ApiError } from './api/request.js';
import { fromBase64Url, toBase64Url, utf8 } from './keys/bytes.js';
import type { Vault, VaultState } from './keys/vault.js';
import { NO_PROJECT_SETTINGS_LOCAL, type ProjectSettingsLocal, type WorktreeLocal } from './views/parametres-projet.js';

export interface ProjectSettingsOptions {
  readonly client: Pick<Client, 'command'>;
  /** The vault that opens and seals the worktree Commandes; none, they stay locked. */
  readonly vault?: Pick<Vault, 'sealItem' | 'openItem'>;
  /**
   * The store's worktree Commandes of a Projet (`undefined` before it has the
   * Paramètres), followed while the page's saves wait for it to hold them,
   * whether the page is shown or not.
   */
  readonly stored?: {
    worktreeCommands(projectId: string): SealedItem | null | undefined;
    subscribe(fn: () => void): () => void;
  };
}

export interface ProjectSettingsLocalState {
  /**
   * The page's own state of a Projet's Paramètres, for `parametresProjetView`,
   * given its stored worktree Commandes and where the vault stands: once the
   * vault is unlocked, the item is opened (a change of this state follows).
   */
  view(projectId: string, sealed: SealedItem | null, vaultState: VaultState): ProjectSettingsLocal;
  /** Stores what a control of the page changed (`PATCH /api/projects/:id/settings`); a refusal on its control. */
  change(projectId: string, name: string, value: string | boolean): Promise<void>;
  /** Sends a setting changed for the Projet back to the account's (`null`). */
  revert(projectId: string, name: string): Promise<void>;
  /** Calls `fn` after each change of this state; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

/** The request's field of a control's refusal: `role:code` → `roles.code`, `branch:integration` → `branches.integration`. */
const fieldOf = (name: string): string => {
  const [kind, key = ''] = name.split(':', 2) as [string, string?];
  if (kind === 'role') return `roles.${key}`;
  if (kind === 'branch') return `branches.${key}`;
  if (kind === 'worktree') return 'worktreeCommands';
  return 'notifications.push';
};

/** The patch of a control's value; `null` for a name the page does not know. */
const patchOf = (name: string, value: string | boolean): ProjectSettingsPatch | null => {
  const [kind, key] = name.split(':', 2);
  if (kind === 'role' && key && typeof value === 'string') {
    const separator = value.indexOf(':');
    if (separator <= 0) return null;
    return { roles: { [key]: { engine: value.slice(0, separator), model: value.slice(separator + 1) } } } as ProjectSettingsPatch;
  }
  if (kind === 'branch' && (key === 'integration' || key === 'release') && typeof value === 'string') return { branches: { [key]: value.trim() } };
  if (name === 'push' && typeof value === 'boolean') return { notifications: { push: value } };
  return null;
};

interface Opened {
  /** The stored item's ciphertext, or `null` for none: what `worktree` was opened from. */
  readonly from: string | null;
  readonly worktree: WorktreeLocal;
}

interface Local {
  readonly errors: Readonly<Record<string, string>>;
  readonly drafts: Readonly<Record<string, string>>;
  readonly opened: Opened | null;
  /**
   * What this page's own saves stored (the item's ciphertext, `null` for
   * none), in their order, until the store holds each: the store gets them by
   * `settings.upserted`, one after the other, and may lag behind the HTTP
   * answers. Until then what it holds (the item before them, one of them, or
   * one they replace) is never opened over what the page saved.
   */
  readonly pending: readonly (string | null)[];
}

const EMPTY: Local = { errors: {}, drafts: {}, opened: null, pending: [] };

/**
 * How many of `pending` the store's item confirms: up to the one it holds. A
 * `null` confirms only the first, since the store may hold the `null` from
 * before the saves until it has the items saved before that one; 0 for an
 * item none of them stored.
 */
const confirmed = (pending: readonly (string | null)[], current: string | null): number => {
  if (current === null) return pending[0] === null ? 1 : 0;
  return pending.indexOf(current) + 1;
};

const asText = (command: string | null): string => command ?? '';
const asCommand = (text: string): string | null => (text.trim() === '' ? null : text);

/**
 * The page's side of a Projet's Paramètres (PARAM-3): the server's refusals
 * on their control, a text typed kept while it is on its way or refused, the
 * worktree Commandes opened by the vault and sealed again, both in one item
 * under `settings:<projectId>`, before they leave the page (ADR 0003). What
 * the commands change comes back through `settings.upserted`.
 */
export const createProjectSettings = ({ client, vault, stored }: ProjectSettingsOptions): ProjectSettingsLocalState => {
  const listeners = new Set<() => void>();
  const locals = new Map<string, Local>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const localOf = (projectId: string): Local => locals.get(projectId) ?? EMPTY;
  const set = (projectId: string, next: Partial<Local>) => {
    locals.set(projectId, { ...localOf(projectId), ...next });
    follow();
    notify();
  };

  /** Drops from a Projet's pending saves those the store's item confirms. */
  const settle = (projectId: string, current: string | null) => {
    const local = localOf(projectId);
    const count = confirmed(local.pending, current);
    if (count > 0) locals.set(projectId, { ...local, pending: local.pending.slice(count) });
  };

  /** Follows the store while a save waits for it: each item it holds settles the saves, the page shown or not. */
  let following: (() => void) | null = null;
  const onStored = () => {
    for (const [projectId, local] of locals) {
      const current = stored?.worktreeCommands(projectId);
      if (local.pending.length > 0 && current !== undefined) settle(projectId, current?.ciphertext ?? null);
    }
    follow();
  };
  function follow() {
    const waiting = [...locals.values()].some((local) => local.pending.length > 0);
    if (waiting && stored && !following) following = stored.subscribe(onStored);
    else if (!waiting && following) {
      following();
      following = null;
    }
  }
  const without = (record: Readonly<Record<string, string>>, name: string): Readonly<Record<string, string>> => {
    const rest = { ...record };
    delete rest[name];
    return rest;
  };

  /** Opens `sealed` with the vault, the page told once it is open (or cannot be). */
  const open = (projectId: string, sealed: SealedItem | null) => {
    const from = sealed?.ciphertext ?? null;
    // An item the page did not seal: it is what the Projet holds now, the page's own saves behind it.
    if (!sealed) {
      locals.set(projectId, { ...localOf(projectId), opened: { from, worktree: { state: 'open', prepare: '', clean: '' } }, pending: [] });
      return;
    }
    locals.set(projectId, { ...localOf(projectId), opened: { from, worktree: { state: 'opening' } }, pending: [] });
    const aad = utf8(worktreeCommandsAad(projectId));
    void (async (): Promise<WorktreeLocal> => {
      try {
        const plaintext = await (vault as NonNullable<typeof vault>).openItem({ key: fromBase64Url(sealed.key), ciphertext: fromBase64Url(sealed.ciphertext) }, aad);
        const commands = zWorktreeCommands.parse(JSON.parse(new TextDecoder().decode(plaintext)));
        return { state: 'open', prepare: asText(commands.prepare), clean: asText(commands.clean) };
      } catch {
        return { state: 'unreadable' };
      }
    })().then((worktree) => {
      // A newer item came meanwhile: its own opening wins.
      if (localOf(projectId).opened?.from === from) set(projectId, { opened: { from, worktree } });
    });
  };

  /** Runs a command for a control: its error cleared first, a refusal kept on it, its draft dropped once stored. */
  const onControl = async (projectId: string, name: string, command: () => Promise<unknown>) => {
    set(projectId, { errors: without(localOf(projectId).errors, name) });
    try {
      await command();
      set(projectId, { drafts: without(localOf(projectId).drafts, name) });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      set(projectId, { errors: { ...localOf(projectId).errors, [name]: error.fields?.[fieldOf(name)] ?? error.message } });
    }
  };

  /** A Projet's commands, one after the other in the order the Pilote gave them: its last value is the one stored. */
  const queues = new Map<string, Promise<void>>();
  const queued = (projectId: string, command: () => Promise<void>): Promise<void> => {
    const next = (queues.get(projectId) ?? Promise.resolve()).then(command);
    const settled = next.catch(() => undefined);
    queues.set(projectId, settled);
    void settled.then(() => {
      if (queues.get(projectId) === settled) queues.delete(projectId);
    });
    return next;
  };

  /** Seals both Commandes, one changed, as one item; both empty removes them (`null`). */
  const changeWorktree = (projectId: string, name: string, text: string): Promise<void> => {
    const opened = localOf(projectId).opened?.worktree;
    if (!vault || !opened || (opened.state !== 'open' && opened.state !== 'unreadable')) return Promise.resolve();
    const command = name === 'worktree:prepare' ? 'prepare' : 'clean';
    const current = opened.state === 'open' ? opened : { prepare: '', clean: '' };
    const texts = { prepare: current.prepare, clean: current.clean, [command]: text };
    // Shown at once; the next change of the other field seals this one with it.
    set(projectId, { opened: { from: localOf(projectId).opened?.from ?? null, worktree: { state: 'open', ...texts } }, drafts: { ...localOf(projectId).drafts, [name]: text } });
    return queued(projectId, () =>
      onControl(projectId, name, async () => {
        // The item this save replaces: the one the save before it stored, once its turn comes.
        const from = localOf(projectId).opened?.from ?? null;
        const commands: WorktreeCommands = { prepare: asCommand(texts.prepare), clean: asCommand(texts.clean) };
        let worktreeCommands: ProjectSettingsPatch['worktreeCommands'] = null;
        if (commands.prepare !== null || commands.clean !== null) {
          const item = await vault.sealItem(utf8(JSON.stringify(commands)), utf8(worktreeCommandsAad(projectId)));
          worktreeCommands = { key: toBase64Url(item.key), ciphertext: toBase64Url(item.ciphertext) };
        }
        const stored = await updateProjectSettings(client, projectId, { worktreeCommands });
        // What was sealed is what the page shows: the item stored needs no opening, and waits for the store to hold it.
        const { opened: opening, pending } = localOf(projectId);
        if (opening?.from === from) {
          const ciphertext = stored.worktreeCommands?.ciphertext ?? null;
          set(projectId, { opened: { from: ciphertext, worktree: opening.worktree }, pending: [...pending, ciphertext] });
        }
      }),
    );
  };

  return {
    view(projectId, sealed, vaultState) {
      const local = localOf(projectId);
      if (vaultState !== 'unlocked' || !vault) return { errors: local.errors, drafts: local.drafts, worktree: NO_PROJECT_SETTINGS_LOCAL.worktree };
      const current = sealed?.ciphertext ?? null;
      if (local.pending.length > 0) {
        // The store follows the page's saves; whatever it holds until it has them all, the page keeps what it saved.
        settle(projectId, current);
        follow();
      } else if (!local.opened || local.opened.from !== current) open(projectId, sealed);
      return { errors: local.errors, drafts: local.drafts, worktree: localOf(projectId).opened?.worktree ?? { state: 'opening' } };
    },
    change(projectId, name, value) {
      if (name.startsWith('worktree:')) return typeof value === 'string' ? changeWorktree(projectId, name, value) : Promise.resolve();
      const patch = patchOf(name, value);
      if (!patch) return Promise.resolve();
      if (typeof value === 'string' && name.startsWith('branch:')) set(projectId, { drafts: { ...localOf(projectId).drafts, [name]: value } });
      return queued(projectId, () => onControl(projectId, name, () => updateProjectSettings(client, projectId, patch)));
    },
    revert(projectId, name) {
      const [kind, key] = name.split(':', 2);
      const patch: ProjectSettingsPatch | null = kind === 'role' && key ? { roles: { [key]: null } } : name === 'push' ? { notifications: { push: null } } : null;
      if (!patch) return Promise.resolve();
      return queued(projectId, () => onControl(projectId, name, () => updateProjectSettings(client, projectId, patch)));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
