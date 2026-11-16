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
}

const EMPTY: Local = { errors: {}, drafts: {}, opened: null };

const asText = (command: string | null): string => command ?? '';
const asCommand = (text: string): string | null => (text.trim() === '' ? null : text);

/**
 * The page's side of a Projet's Paramètres (PARAM-3): the server's refusals
 * on their control, a text typed kept while it is on its way or refused, the
 * worktree Commandes opened by the vault and sealed again, both in one item
 * under `settings:<projectId>`, before they leave the page (ADR 0003). What
 * the commands change comes back through `settings.upserted`.
 */
export const createProjectSettings = ({ client, vault }: ProjectSettingsOptions): ProjectSettingsLocalState => {
  const listeners = new Set<() => void>();
  const locals = new Map<string, Local>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const localOf = (projectId: string): Local => locals.get(projectId) ?? EMPTY;
  const set = (projectId: string, next: Partial<Local>) => {
    locals.set(projectId, { ...localOf(projectId), ...next });
    notify();
  };
  const without = (record: Readonly<Record<string, string>>, name: string): Readonly<Record<string, string>> => {
    const rest = { ...record };
    delete rest[name];
    return rest;
  };

  /** Opens `sealed` with the vault, the page told once it is open (or cannot be). */
  const open = (projectId: string, sealed: SealedItem | null) => {
    const from = sealed?.ciphertext ?? null;
    if (!sealed) {
      locals.set(projectId, { ...localOf(projectId), opened: { from, worktree: { state: 'open', prepare: '', clean: '' } } });
      return;
    }
    locals.set(projectId, { ...localOf(projectId), opened: { from, worktree: { state: 'opening' } } });
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

  /** Seals both Commandes, one changed, as one item; both empty removes them. */
  const changeWorktree = (projectId: string, name: string, text: string): Promise<void> => {
    const opened = localOf(projectId).opened?.worktree;
    if (!vault || !opened || (opened.state !== 'open' && opened.state !== 'unreadable')) return Promise.resolve();
    const command = name === 'worktree:prepare' ? 'prepare' : 'clean';
    const current = opened.state === 'open' ? opened : { prepare: '', clean: '' };
    const texts = { prepare: current.prepare, clean: current.clean, [command]: text };
    const from = localOf(projectId).opened?.from ?? null;
    // Shown at once; the next change of the other field seals this one with it.
    set(projectId, { opened: { from, worktree: { state: 'open', ...texts } }, drafts: { ...localOf(projectId).drafts, [name]: text } });
    return queued(projectId, () =>
      onControl(projectId, name, async () => {
        const commands: WorktreeCommands = { prepare: asCommand(texts.prepare), clean: asCommand(texts.clean) };
        let worktreeCommands: ProjectSettingsPatch['worktreeCommands'] = null;
        if (commands.prepare !== null || commands.clean !== null) {
          const item = await vault.sealItem(utf8(JSON.stringify(commands)), utf8(worktreeCommandsAad(projectId)));
          worktreeCommands = { key: toBase64Url(item.key), ciphertext: toBase64Url(item.ciphertext) };
        }
        const stored = await updateProjectSettings(client, projectId, { worktreeCommands });
        // What was sealed is what the page shows: the item stored needs no opening again.
        const opening = localOf(projectId).opened;
        if (opening?.from === from) set(projectId, { opened: { from: stored.worktreeCommands?.ciphertext ?? null, worktree: opening.worktree } });
      }),
    );
  };

  return {
    view(projectId, sealed, vaultState) {
      const local = localOf(projectId);
      if (vaultState !== 'unlocked' || !vault) return { errors: local.errors, drafts: local.drafts, worktree: NO_PROJECT_SETTINGS_LOCAL.worktree };
      if (!local.opened || local.opened.from !== (sealed?.ciphertext ?? null)) open(projectId, sealed);
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
