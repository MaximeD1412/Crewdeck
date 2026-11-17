import { ideaItemAad, type IdeaNotedFrom, type Project } from '@crewdeck/contracts';
import { t, type ComposantData, type NoteIdeaDialog } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { noteIdea } from './api/ideas.js';
import { ApiError } from './api/request.js';
import { uuidv7 } from './ids.js';
import { toBase64Url, utf8 } from './keys/bytes.js';
import type { Vault } from './keys/vault.js';
import type { Store } from './store/store.js';

export type NoteIdeaDialogData = ComposantData<typeof NoteIdeaDialog>;

/** The width from which the page is a computer's (`design/DESIGN.md`, « Layout »): below, an Idée is noted from the phone. */
export const DESKTOP_MIN_WIDTH = 1280;

export interface NoteIdeaOptions {
  readonly client: Pick<Client, 'command'>;
  readonly vault: Pick<Vault, 'sealItem'>;
  readonly store: Pick<Store, 'getState'>;
  /** The page's width: `innerWidth` by default. */
  readonly width?: () => number;
  /** A new Idée's id: a UUIDv7 drawn here by default. */
  readonly newId?: () => string;
  /** A Projet's name (`projects.ts`, `projectName`): its `displayName`, else « Projet local », by default. */
  readonly projectName?: (project: Pick<Project, 'id' | 'displayName' | 'nameSealed'>) => string;
}

export interface NoteIdea {
  /** The Dialog's data: its own state, the Projets by name, `locked` while the vault is not open. */
  view(): NoteIdeaDialogData;
  /** Opens the Dialog, `defaultProjectId` chosen (the page's Projet filter, `null` for none). */
  open(defaultProjectId: string | null): void;
  cancel(): void;
  /** Seals the text and notes the Idée; a refusal stays in the Dialog. */
  submit(input: { readonly text: string; readonly projectId: string | null }): Promise<void>;
  subscribe(fn: () => void): () => void;
}

interface Local {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly defaultProjectId: string | null;
}

const CLOSED: Local = { open: false, busy: false, error: null, defaultProjectId: null };

/**
 * « Noter une Idée » (US-5, IDEE-1), the same Dialog from « Idées » and
 * « À toi »: the text trimmed, an empty one refused before anything; the
 * Idée's id drawn here, its text sealed under the vault key with the
 * additional data `"<id>:text"` (ADR 0003), never sent in clear; `notedFrom`
 * `telephone` below 1280 px. The Dialog closes once the server noted it;
 * the store shows it through `idea.upserted`.
 */
export const createNoteIdea = ({
  client,
  vault,
  store,
  width = () => innerWidth,
  newId = () => uuidv7(),
  projectName = (project) => project.displayName ?? t('projets.local.fallbackName'),
}: NoteIdeaOptions): NoteIdea => {
  let state = CLOSED;
  const listeners = new Set<() => void>();
  const set = (next: Partial<Local>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const locked = () => store.getState().vaultState !== 'unlocked';

  return {
    view() {
      const projects: readonly Pick<Project, 'id' | 'displayName' | 'nameSealed'>[] = [...(store.getState().slices.project?.values() ?? [])];
      return {
        ...state,
        projects: projects.map((project) => ({ id: project.id, name: projectName(project) })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
        locked: locked(),
      };
    },
    open: (defaultProjectId) => set({ open: true, busy: false, error: null, defaultProjectId }),
    cancel() {
      if (!state.busy) set(CLOSED);
    },
    async submit({ text, projectId }) {
      if (state.busy) return;
      const trimmed = text.trim();
      if (locked()) return set({ error: t('idees.note.locked') });
      if (trimmed === '') return set({ error: t('idees.note.empty') });
      set({ busy: true, error: null });
      const id = newId();
      const notedFrom: IdeaNotedFrom = width() < DESKTOP_MIN_WIDTH ? 'telephone' : 'pc';
      try {
        const sealed = await vault.sealItem(utf8(trimmed), utf8(ideaItemAad(id, 'text')));
        await noteIdea(client, {
          id,
          text: { key: toBase64Url(sealed.key), ciphertext: toBase64Url(sealed.ciphertext) },
          projectId,
          notedFrom,
          dictated: false,
        });
        set(CLOSED);
      } catch (error) {
        if (!(error instanceof ApiError)) {
          set({ busy: false });
          throw error;
        }
        set({ busy: false, error: error.fields?.['text.ciphertext'] ?? error.fields?.['text'] ?? error.fields?.['projectId'] ?? error.message });
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
