import type { CreateRole, RoleChoice } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { createRole, removeRole } from './api/roles.js';
import { updateSettings } from './api/settings.js';
import { NO_ROLES_LOCAL, type RolesLocal } from './views/parametres.js';

export interface RoleSettingsOptions {
  readonly client: Pick<Client, 'command'>;
}

export interface RoleSettingsState {
  /** The page's own state of « Rôles et modèles », for `parametresView`. */
  view(): RolesLocal;
  /** Opens the Dialog « Nouveau Rôle », without error. */
  open(): void;
  /** Closes it, unless the Rôle is on its way. */
  cancel(): void;
  /** Adds the Rôle (`POST /api/roles`), the Dialog busy meanwhile; a refusal under its field, the Dialog left open. */
  create(body: CreateRole): Promise<void>;
  /** Stores a Rôle's model (`PATCH /api/settings`) once the row's commands before it are done; a refusal on its row. */
  choose(roleId: string, choice: NonNullable<RoleChoice>): Promise<void>;
  /** Removes a Rôle the Pilote added (`DELETE /api/roles/:id`); a refusal on its row. */
  remove(roleId: string): Promise<void>;
  /** Calls `fn` after each change of this state; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

/**
 * The page's side of the Rôles (PARAM-2): what the store does not hold, the
 * Dialog « Nouveau Rôle » and the server's refusals, each shown where it
 * belongs. What the commands change comes back through `settings.upserted`.
 */
export const createRoleSettings = ({ client }: RoleSettingsOptions): RoleSettingsState => {
  const listeners = new Set<() => void>();
  let state: RolesLocal = NO_ROLES_LOCAL;

  const set = (next: Partial<RolesLocal>) => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener();
  };
  const setAdding = (next: Partial<RolesLocal['adding']>) => set({ adding: { ...state.adding, ...next } });
  const setError = (roleId: string, message: string | null) => {
    const { [roleId]: _gone, ...errors } = state.errors;
    if (message !== null || _gone !== undefined) set({ errors: message === null ? errors : { ...errors, [roleId]: message } });
  };

  /** Runs a command for a row: its error cleared first, a refusal kept on it. */
  const onRow = async (roleId: string, command: () => Promise<unknown>, field?: string) => {
    setError(roleId, null);
    try {
      await command();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setError(roleId, (field ? error.fields?.[field] : undefined) ?? error.message);
    }
  };

  /**
   * A row's commands, one after the other in the order the Pilote gave them:
   * its last choice is the one the server stores, its last refusal the one shown.
   */
  const rows = new Map<string, Promise<void>>();
  const queued = (roleId: string, command: () => Promise<unknown>, field?: string): Promise<void> => {
    const next = (rows.get(roleId) ?? Promise.resolve()).then(() => onRow(roleId, command, field));
    const settled = next.catch(() => undefined);
    rows.set(roleId, settled);
    void settled.then(() => {
      if (rows.get(roleId) === settled) rows.delete(roleId);
    });
    return next;
  };

  return {
    view: () => state,
    open: () => set({ adding: { open: true, busy: false, nameError: null, modelError: null } }),
    cancel() {
      if (!state.adding.busy) set({ adding: NO_ROLES_LOCAL.adding });
    },
    async create({ name, engine, model }) {
      if (state.adding.busy) return;
      const trimmed = name.trim();
      if (trimmed === '') {
        setAdding({ nameError: t('settings.roles.nameRequired'), modelError: null });
        return;
      }
      setAdding({ busy: true, nameError: null, modelError: null });
      try {
        await createRole(client, { name: trimmed, engine, model });
        set({ adding: NO_ROLES_LOCAL.adding });
      } catch (error) {
        if (!(error instanceof ApiError)) {
          setAdding({ busy: false });
          throw error;
        }
        const modelError = error.fields?.['model'] ?? null;
        setAdding({ busy: false, nameError: error.fields?.['name'] ?? (modelError ? null : error.message), modelError });
      }
    },
    choose: (roleId, choice) => queued(roleId, () => updateSettings(client, { roles: { [roleId]: choice } }), `roles.${roleId}`),
    remove: (roleId) => queued(roleId, () => removeRole(client, roleId)),
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
