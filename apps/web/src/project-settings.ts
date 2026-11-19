import {
  worktreeCommandsAad,
  zWorktreeCommands,
  type ProjectSettingsPatch,
  type ProjectSettingsUpdated,
  type SealedItem,
  type WorktreeCommands,
} from '@crewdeck/contracts';
import type { Client } from './api/client.js';
import { updateProjectSettings } from './api/project-settings.js';
import { ApiError } from './api/request.js';
import { fromBase64Url, toBase64Url, utf8 } from './keys/bytes.js';
import { sealedWrite } from './keys/sealed-write.js';
import type { Vault, VaultState } from './keys/vault.js';
import { NO_PROJECT_SETTINGS_LOCAL, type ProjectSettingsLocal, type WorktreeLocal } from './views/parametres-projet.js';

export interface ProjectSettingsOptions {
  readonly client: Pick<Client, 'command'>;
  /** The vault that opens and seals the worktree Commandes; none, they stay locked. */
  readonly vault?: Pick<Vault, 'sealItem' | 'openItem' | 'unlockVault'>;
  /** The store, followed while the page's saves wait for it to hold them, whether the page is shown or not. */
  readonly stored: {
    /**
     * The `seq` the store holds (ADR 0007), its last event's or its
     * snapshot's, `null` before either: a save is in the store once it
     * reaches the `seq` its answer gave, whatever came with it.
     */
    seq(): bigint | null;
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
   * This page's own saves of the worktree Commandes until the store holds
   * each: the store gets them by `settings.upserted`, or by a snapshot, and
   * may lag behind the HTTP answers. Until then what it holds (the item
   * before them, or one they replace) is never opened over what the page saved.
   */
  readonly pending: readonly Saving[];
}

/** A save of the worktree Commandes: the `seq` its answer gave, `null` while it is on its way. */
interface Saving {
  seq: bigint | null;
}

const EMPTY: Local = { errors: {}, drafts: {}, opened: null, pending: [] };

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

  /** Whether the store holds a save: answered, and the store's `seq` at its own or past it. */
  const held = (saving: Saving): boolean => {
    if (saving.seq === null) return false;
    const seq = stored.seq();
    return seq !== null && seq >= saving.seq;
  };

  /** Drops the saves the store holds, the page shown or not; it is told when that let the store's item through. */
  const onStored = () => {
    let settled = false;
    for (const [projectId, local] of locals) {
      if (local.pending.length === 0) continue;
      const pending = local.pending.filter((saving) => !held(saving));
      if (pending.length === local.pending.length) continue;
      locals.set(projectId, { ...local, pending });
      settled = true;
    }
    follow();
    // The page shown follows: the store's item, once the saves are all held, opens.
    if (settled) notify();
  };
  let following: (() => void) | null = null;
  function follow() {
    const waiting = [...locals.values()].some((local) => local.pending.length > 0);
    if (waiting && !following) following = stored.subscribe(onStored);
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

  /**
   * Seals both Commandes, one changed, as one item, with the version of the
   * vault key (sealed again once under the new one when the vault rotated
   * meanwhile, E2E-4); both empty removes them (`null`).
   */
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
        const save = async (): Promise<ProjectSettingsUpdated> => {
          if (commands.prepare === null && commands.clean === null) return updateProjectSettings(client, projectId, { worktreeCommands: null });
          const item = await vault.sealItem(utf8(JSON.stringify(commands)), utf8(worktreeCommandsAad(projectId)));
          const worktreeCommands: ProjectSettingsPatch['worktreeCommands'] = { key: toBase64Url(item.key), ciphertext: toBase64Url(item.ciphertext) };
          return updateProjectSettings(client, projectId, { worktreeCommands, vaultKeyVersion: item.vaultKeyVersion });
        };
        // Pending from the start: whatever the store holds while it is on its way, the page keeps what it saves.
        const saving: Saving = { seq: null };
        set(projectId, { pending: [...localOf(projectId).pending, saving] });
        let answer: ProjectSettingsUpdated;
        try {
          answer = await sealedWrite(vault, save);
        } catch (error) {
          // Refused: it stored nothing, nothing to wait for.
          locals.set(projectId, { ...localOf(projectId), pending: localOf(projectId).pending.filter((entry) => entry !== saving) });
          follow();
          throw error;
        }
        // What was sealed is what the page shows: the item stored needs no opening, and waits for the store to reach its `seq`.
        saving.seq = BigInt(answer.seq);
        const { opened: opening, pending } = localOf(projectId);
        const ciphertext = answer.worktreeCommands?.ciphertext ?? null;
        set(projectId, {
          pending: pending.filter((entry) => !held(entry)),
          ...(opening?.from === from ? { opened: { from: ciphertext, worktree: opening.worktree } } : {}),
        });
      }),
    );
  };

  return {
    view(projectId, sealed, vaultState) {
      const local = localOf(projectId);
      if (vaultState !== 'unlocked' || !vault) return { errors: local.errors, drafts: local.drafts, worktree: NO_PROJECT_SETTINGS_LOCAL.worktree };
      const current = sealed?.ciphertext ?? null;
      // Until the store holds the page's saves, whatever it holds, the page keeps what it saved.
      if (local.pending.length === 0 && (!local.opened || local.opened.from !== current)) open(projectId, sealed);
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
