import type { Arrow, ProcessDefinition, ProjectProcess } from '@crewdeck/contracts';
import type { Client } from '../api/client.js';
import type { EditorEdits, EditorToast } from '../views/process-editor.js';
import { createDraftSaver, type DraftSaver } from './draft.js';
import type { EditResult } from './edit.js';

/** How long a refusal or a notice stays over the canvas, unless an edit comes first. */
export const TOAST_MS = 6000;

export interface EditingOptions {
  readonly client: Pick<Client, 'command'>;
  /** The store's view of a Projet's Process. */
  readonly stored: (projectId: string) => ProjectProcess | undefined;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

export interface Editing {
  /** What the page shows of a Projet's edits: its view, the catalogue, the refusal, the Dialog, the name's refusal and focus. */
  edits(projectId: string): EditorEdits;
  /** The definition the canvas shows, edits included. */
  definition(projectId: string): ProcessDefinition | undefined;
  /** Applies an edit to the shown definition, saved behind; the last refusal and the name's go first. */
  apply(projectId: string, change: (definition: ProcessDefinition) => EditResult): EditResult;
  /** Shows a refusal over the canvas for `TOAST_MS`, with the arrow refused when it was one. */
  refuse(projectId: string, text: string, arrow?: Arrow): void;
  /** Shows a notice over the canvas for `TOAST_MS` (a Retour drawn). */
  inform(projectId: string, text: string): void;
  /** Opens the catalogue (closing « Attacher un Outil »), or closes it. */
  setCatalogue(projectId: string, open: boolean): void;
  /** Opens « Attacher un Outil » for an Étape (closing the catalogue), `null` to close it. */
  setAttach(projectId: string, stepId: string | null): void;
  /** The Phase whose removal the Dialog asks, `null` to close it. */
  askRemovePhase(projectId: string, phaseId: string | null): void;
  /** Why a Phase's name was refused, shown under its field until the next edit. */
  refuseName(projectId: string, phaseId: string, text: string): void;
  /** Asks to focus a Phase's name (a Phase just added). */
  focusName(projectId: string, phaseId: string): void;
  /** Resolves once every Projet's draft is saved or refused. */
  settled(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

interface Kept {
  saver: DraftSaver;
  catalogue: boolean;
  attach: string | null;
  removingPhase: string | null;
  toast: EditorToast | null;
  timer: unknown;
  nameError: EditorEdits['nameError'];
  focusName: EditorEdits['focusName'];
  asked: number;
}

/**
 * The edits of « Gestion du process » (US-93, US-95), per Projet while the
 * tab lives: each Projet's draft saver (`draft.ts`), and what the page shows
 * beside the canvas: the catalogue or « Attacher un Outil » open, the Dialog
 * asked, the last refusal and the arrow it refused, or the last notice (gone
 * after 6 s or at the next edit), the name's refusal and focus.
 */
export const createEditing = ({ client, stored, setTimer = (run, ms) => setTimeout(run, ms), clearTimer = (timer) => clearTimeout(timer as number) }: EditingOptions): Editing => {
  const kept = new Map<string, Kept>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const showToast = (entry: Kept, toast: EditorToast | null): void => {
    if (entry.timer !== null) clearTimer(entry.timer);
    entry.timer = null;
    entry.toast = toast;
    if (toast !== null) {
      entry.timer = setTimer(() => {
        entry.timer = null;
        entry.toast = null;
        notify();
      }, TOAST_MS);
    }
  };

  const keptOf = (projectId: string): Kept => {
    let entry = kept.get(projectId);
    if (!entry) {
      const saver = createDraftSaver({
        projectId,
        client,
        stored: () => stored(projectId),
        onFailure: (text) => showToast(keptOf(projectId), { tone: 'halt', text, arrow: null }),
      });
      saver.subscribe(notify);
      entry = { saver, catalogue: false, attach: null, removingPhase: null, toast: null, timer: null, nameError: null, focusName: null, asked: 0 };
      kept.set(projectId, entry);
    }
    return entry;
  };

  return {
    edits: (projectId) => {
      const entry = kept.get(projectId);
      if (!entry) return { saving: false, catalogue: false, attach: null, removingPhase: null, toast: null, nameError: null, focusName: null };
      const { saver, catalogue, attach, removingPhase, toast, nameError, focusName } = entry;
      return { shown: saver.view(), saving: saver.saving(), catalogue, attach, removingPhase, toast, nameError, focusName };
    },
    definition: (projectId) => {
      const view = kept.get(projectId)?.saver.view() ?? stored(projectId);
      return view?.draft?.definition ?? view?.active?.definition;
    },
    apply: (projectId, change) => {
      const entry = keptOf(projectId);
      showToast(entry, null);
      entry.nameError = null;
      const result = entry.saver.edit(change);
      notify();
      return result;
    },
    refuse: (projectId, text, arrow) => {
      showToast(keptOf(projectId), { tone: 'halt', text, arrow: arrow ?? null });
      notify();
    },
    inform: (projectId, text) => {
      showToast(keptOf(projectId), { tone: 'accent', text, arrow: null });
      notify();
    },
    setCatalogue: (projectId, open) => {
      const entry = keptOf(projectId);
      entry.catalogue = open;
      if (open) entry.attach = null;
      notify();
    },
    setAttach: (projectId, stepId) => {
      const entry = keptOf(projectId);
      entry.attach = stepId;
      if (stepId !== null) entry.catalogue = false;
      notify();
    },
    askRemovePhase: (projectId, phaseId) => {
      keptOf(projectId).removingPhase = phaseId;
      notify();
    },
    refuseName: (projectId, phaseId, text) => {
      keptOf(projectId).nameError = { phaseId, text };
      notify();
    },
    focusName: (projectId, phaseId) => {
      const entry = keptOf(projectId);
      entry.asked += 1;
      entry.focusName = { phaseId, at: entry.asked };
      notify();
    },
    settled: async () => {
      await Promise.all([...kept.values()].map((entry) => entry.saver.settled()));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
