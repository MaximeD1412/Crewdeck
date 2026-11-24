import {
  processSealAad,
  processTemplateNameKey,
  templateSealAad,
  type ProcessTemplate,
  type ProjectProcess,
} from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { removeProcessTemplate, renameProcessTemplate, saveProcessTemplate } from './api/process-templates.js';
import { ApiError } from './api/request.js';
import { uuidv7 } from './ids.js';
import type { Vault } from './keys/vault.js';
import type { EditorUiState, SaveTemplateUi } from './process/editor-ui.js';
import { resealProcess } from './process/seal.js';

/** What the Modèles read of the store: the Projets' Process, the Pilote's Modèles. */
export interface TemplatesStore {
  readonly process?: ReadonlyMap<string, ProjectProcess>;
  readonly 'process-template'?: ReadonlyMap<string, ProcessTemplate>;
}

export interface SaveTemplateOptions {
  readonly ui: Pick<EditorUiState, 'saveTemplate' | 'toast' | 'view'>;
  readonly client: Pick<Client, 'command'>;
  readonly vault: Pick<Vault, 'sealItem' | 'openItem'>;
  readonly slices: () => TemplatesStore;
  /** The Projet of the page. */
  readonly projectId: () => string;
}

/** The Pilote's Modèle whose name is `name`'s, whatever its case and outer spaces. */
export const templateNamed = (templates: ReadonlyMap<string, ProcessTemplate> | undefined, name: string): ProcessTemplate | undefined => {
  const key = processTemplateNameKey(name);
  return [...(templates?.values() ?? [])].find((template) => processTemplateNameKey(template.name) === key);
};

/** Why a command was refused: its message on `fields.name`, else its own. */
const refusal = (error: unknown): string => {
  if (!(error instanceof ApiError)) throw error;
  return error.fields?.['name'] ?? error.message;
};

/**
 * « Enregistrer comme Modèle de process » (PROCESS-14, US-97): the Dialog
 * opened on « Process {Projet} »; a name of one of the Pilote's Modèles first
 * refused with « Remplacer « {name} » » offered (never replaced unasked),
 * submitted again, replaces it. The active version's sealed part is sealed
 * again under `template:<id>` for an id the page draws (the replaced Modèle's
 * own when replacing), then the route; saved, the Dialog closes on a go
 * Toast, refused, the reason under the name.
 */
export const createSaveTemplate = ({ ui, client, vault, slices, projectId }: SaveTemplateOptions) => {
  const refuse = (id: string, open: SaveTemplateUi) => ui.saveTemplate(id, open);
  return {
    open: (): void => ui.saveTemplate(projectId(), { name: null, error: null, replaceId: null }),
    close: (): void => ui.saveTemplate(projectId(), null),
    save: async ({ name }: { readonly name: string }): Promise<void> => {
      const id = projectId();
      const asked = ui.view(id, {}).saveTemplate ?? null;
      const active = slices().process?.get(id)?.active ?? null;
      if (asked === null || active === null) return;
      const same = templateNamed(slices()['process-template'], name);
      if (same && asked.replaceId !== same.id) return refuse(id, { name, error: t('process.template.nameTaken'), replaceId: same.id });
      const templateId = same?.id ?? uuidv7();
      try {
        const sealed = await resealProcess(vault, active.sealed, processSealAad(id), templateSealAad(templateId));
        const saved = await saveProcessTemplate(client, { id: templateId, name, projectId: id, versionNumber: active.number, sealed, replace: same !== undefined });
        ui.saveTemplate(id, null);
        ui.toast(id, { tone: 'go', icon: 'check', text: t('process.template.saved', { name: saved.name }) });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'process-template.name-taken') {
          return refuse(id, { name, error: t('process.template.nameTaken'), replaceId: templateNamed(slices()['process-template'], name)?.id ?? null });
        }
        refuse(id, { name, error: error instanceof ApiError ? refusal(error) : t('process.template.locked'), replaceId: null });
      }
    },
  };
};

/** The Paramètres' own state of « Modèles de process »: the Dialog open, if any. */
export interface TemplateListLocal {
  readonly renaming: { readonly id: string; readonly name: string; readonly error: string | null } | null;
  readonly removing: { readonly id: string; readonly name: string } | null;
}

export const NO_TEMPLATE_LIST_LOCAL: TemplateListLocal = { renaming: null, removing: null };

export interface TemplateListOptions {
  readonly client: Pick<Client, 'command'>;
  readonly templates: () => ReadonlyMap<string, ProcessTemplate> | undefined;
}

/**
 * The Paramètres' side of the Modèles (PROCESS-14, US-111): « Renommer »
 * and « Supprimer » open their Dialog, the commands close it; a rename
 * refused keeps it open, the reason under the name. What they change comes
 * back through `process-template.upserted` and `.removed`.
 */
export const createTemplateList = ({ client, templates }: TemplateListOptions) => {
  const listeners = new Set<() => void>();
  let state: TemplateListLocal = NO_TEMPLATE_LIST_LOCAL;
  const set = (next: TemplateListLocal) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const named = (id: string) => templates()?.get(id);
  return {
    view: (): TemplateListLocal => state,
    rename: (id: string): void => {
      const template = named(id);
      if (template) set({ renaming: { id, name: template.name, error: null }, removing: null });
    },
    submitRename: async (id: string, name: string): Promise<void> => {
      if (named(id)?.name === name) return set(NO_TEMPLATE_LIST_LOCAL);
      try {
        await renameProcessTemplate(client, id, { name });
        if (state.renaming?.id === id) set(NO_TEMPLATE_LIST_LOCAL);
      } catch (error) {
        if (state.renaming?.id === id) set({ ...state, renaming: { id, name, error: refusal(error) } });
      }
    },
    remove: (id: string): void => {
      const template = named(id);
      if (template) set({ renaming: null, removing: { id, name: template.name } });
    },
    confirmRemove: async (id: string): Promise<void> => {
      set(NO_TEMPLATE_LIST_LOCAL);
      try {
        await removeProcessTemplate(client, id);
      } catch (error) {
        // Gone already: what the Pilote asked for. Anything else is the page's to say.
        if (!(error instanceof ApiError) || error.code !== 'process-template.not-found') throw error;
      }
    },
    cancel: (): void => set(NO_TEMPLATE_LIST_LOCAL),
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export type TemplateList = ReturnType<typeof createTemplateList>;
