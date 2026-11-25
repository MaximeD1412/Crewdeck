import type { SourceGroup, SourceKind } from '@crewdeck/contracts';
import type { ComposantData, Toast } from '@crewdeck/sdk';
import type { Selection } from './canvas.js';

export type EditorToast = ComposantData<typeof Toast>;

/** The panel's tabs: the Manques, the selected Étape or Phase, the Sources. */
export type EditorTab = 'gaps' | 'selection' | 'sources';

/** What the URL holds of « Gestion du process »: so that a Manque, a Décision or a test opens the page on its block. */
export interface EditorQuery {
  readonly selection: Selection | null;
  readonly tab: EditorTab;
}

export interface EditorView {
  readonly zoom: number;
  readonly pan: { readonly x: number; readonly y: number };
}

/** The page's own state for one Projet: its URL's, its view, the block the canvas is asked to centre, its Toast. */
export interface EditorUi extends EditorQuery, EditorView {
  readonly focus: { readonly id: string; readonly at: number } | null;
  readonly toast: EditorToast | null;
  /** The Source chosen in a group's Select while its confirmation is open: the Select shows it, then goes back. */
  readonly choice?: SourceChoice | null;
  /** The Dialog « Enregistrer comme Modèle de process » while open (PROCESS-14); `null` or absent while closed. */
  readonly saveTemplate?: SaveTemplateUi | null;
}

/** The Dialog « Enregistrer comme Modèle de process »: the name last submitted (`null`: « Process {Projet} »), its refusal, the Modèle it would replace. */
export interface SaveTemplateUi {
  readonly name: string | null;
  readonly error: string | null;
  readonly replaceId: string | null;
}

/** A group's Select changed, not yet confirmed. */
export interface SourceChoice {
  readonly group: SourceGroup;
  readonly to: SourceKind;
}

/** The query's words for each tab (French, as the page URLs are). */
const TAB_WORDS: Readonly<Record<EditorTab, string>> = { gaps: 'manques', selection: 'etape', sources: 'sources' };
const tabOfWord = (word: string | undefined): EditorTab | null =>
  (Object.keys(TAB_WORDS) as EditorTab[]).find((tab) => TAB_WORDS[tab] === word) ?? null;

const defaultTab = (selection: Selection | null): EditorTab => (selection ? 'selection' : 'gaps');

/** `?etape=<stepId>`, `?phase=<phaseId>`, `?onglet=manques|etape|sources`: the tab of the selection by default, else « Manques ». */
export const editorQueryOf = (query: Readonly<Record<string, string>>): EditorQuery => {
  const step = query['etape'];
  const phase = query['phase'];
  const selection: Selection | null = step ? { kind: 'step', id: step } : phase ? { kind: 'phase', id: phase } : null;
  return { selection, tab: tabOfWord(query['onglet']) ?? defaultTab(selection) };
};

/** « Gestion du process »' URL for a Projet, its selection and its tab, as `editorQueryOf` reads it. */
export const processHref = (projectId: string, { selection, tab }: EditorQuery): string => {
  const params = new URLSearchParams();
  if (selection?.kind === 'step' && selection.id) params.set('etape', selection.id);
  if (selection?.kind === 'phase' && selection.id) params.set('phase', selection.id);
  if (tab !== defaultTab(selection?.kind === 'sources' ? null : selection)) params.set('onglet', TAB_WORDS[tab]);
  const query = params.toString();
  return `/projets/${encodeURIComponent(projectId)}/process${query ? `?${query}` : ''}`;
};

/** The zoom a Projet's canvas opens at. */
export const DEFAULT_ZOOM = 90;

/** How long a Toast stays over the canvas: the core removes it (the Toast never does). */
export const TOAST_MS = 5000;

interface Kept {
  view: EditorView;
  choice: SourceChoice | null;
  saveTemplate: SaveTemplateUi | null;
  /** The centring asked and not yet done: the canvas's next `view` says it is. */
  focus: EditorUi['focus'];
  /** How many centrings were asked, so that each has its own `at`. */
  asked: number;
  toast: EditorToast | null;
  /** The removal of the Toast shown. */
  timer: ReturnType<typeof setTimeout> | null;
}

export interface EditorUiState {
  /** The page's state for a Projet: from its URL, and its view kept in memory, opened centred on the URL's block. */
  view(projectId: string, query: Readonly<Record<string, string>>): EditorUi;
  /** The Source chosen in a group's Select, its confirmation open; `null` once answered. */
  choose(projectId: string, choice: SourceChoice | null): void;
  /** The canvas's view at the end of a gesture or of a centring, which it ends: a canvas made again keeps that view. */
  setView(projectId: string, view: EditorView): void;
  /** Asks the canvas to centre the block `id` (a Manque chosen). */
  centre(projectId: string, id: string): void;
  /** Opens, changes (`SaveTemplateUi`) or closes (`null`) the Dialog « Enregistrer comme Modèle de process ». */
  saveTemplate(projectId: string, state: SaveTemplateUi | null): void;
  /** Shows a Toast over the Projet's canvas for `TOAST_MS`, replacing the one shown. */
  toast(projectId: string, toast: EditorToast): void;
  subscribe(listener: () => void): () => void;
}

/** « Gestion du process »' own state, per Projet, while the browser's tab lives. */
export const createEditorUi = (): EditorUiState => {
  const kept = new Map<string, Kept>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const keptOf = (projectId: string, query: EditorQuery | null): Kept => {
    let entry = kept.get(projectId);
    if (!entry) {
      const id = query?.selection?.id ?? null;
      entry = { view: { zoom: DEFAULT_ZOOM, pan: { x: 0, y: 0 } }, choice: null, saveTemplate: null, focus: id === null || query?.selection?.kind === 'sources' ? null : { id, at: 0 }, asked: 0, toast: null, timer: null };
      kept.set(projectId, entry);
    }
    return entry;
  };
  return {
    view: (projectId, query) => {
      const parsed = editorQueryOf(query);
      const { view, focus, toast, choice, saveTemplate } = keptOf(projectId, parsed);
      return { ...parsed, zoom: view.zoom, pan: { ...view.pan }, focus, toast, choice, saveTemplate };
    },
    choose: (projectId, choice) => {
      keptOf(projectId, null).choice = choice;
      notify();
    },
    saveTemplate: (projectId, state) => {
      keptOf(projectId, null).saveTemplate = state;
      notify();
    },
    setView: (projectId, view) => {
      const entry = keptOf(projectId, null);
      entry.view = { zoom: view.zoom, pan: { x: view.pan.x, y: view.pan.y } };
      entry.focus = null;
      notify();
    },
    centre: (projectId, id) => {
      const entry = keptOf(projectId, null);
      entry.asked += 1;
      entry.focus = { id, at: entry.asked };
      notify();
    },
    toast: (projectId, toast) => {
      const entry = keptOf(projectId, null);
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.toast = toast;
      entry.timer = setTimeout(() => {
        entry.toast = null;
        entry.timer = null;
        notify();
      }, TOAST_MS);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
