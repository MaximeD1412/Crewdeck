import type { Dictation } from '@crewdeck/sdk';
import { dictationError, isDictationAvailable, startDictation, type DictationHandle } from './dictation.js';

/** Where this Appareil keeps that its Pilote read the notice on the browser's service (risk SEC-9). */
export const DICTATION_NOTICE_KEY = 'crewdeck.dictation.notice';

export interface DictationFieldOptions {
  /** Each time `view()` or `text` changes: the transcript, each second while dictating, the end. */
  readonly onChange: () => void;
  /** `localStorage` by default. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

export interface DictationField {
  /** The Composant's `dictation`. */
  view(): Dictation;
  /** The field's text as the core sets it: what it held when the dictation began, then the transcript after it. */
  readonly text: string;
  /** Whether some of the text came from a dictation since the last `reset()`. */
  readonly dictated: boolean;
  /** Dictates after `text`, what the field holds now; nothing while it already dictates. */
  start(text: string): void;
  stop(): void;
  /** A new field: the dictation stopped, the text, the error and `dictated` forgotten; its owner says it changed. */
  reset(): void;
}

const SECOND = 1000;

const join = (before: string, transcript: string): string => {
  if (transcript === '') return before;
  if (before === '' || /\s$/.test(before)) return before + transcript;
  return `${before} ${transcript}`;
};

/**
 * One field's dictation (US-57), for the Composant that holds it: the
 * browser's recognition in French (`startDictation`), its transcript after
 * what the field held, interim words included; the seconds counted while it
 * listens; why it ended on an error. The first dictation of an Appareil shows
 * the notice on the browser's service, then never again on it. The
 * transcript stays in the page: it leaves only as what the Pilote sends.
 */
export const createDictationField = ({ onChange, storage = localStorage }: DictationFieldOptions): DictationField => {
  let handle: DictationHandle | null = null;
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let before = '';
  let text = '';
  let dictated = false;
  let error: string | null = null;
  let notice = false;

  const noticeSeen = (): boolean => {
    try {
      return storage.getItem(DICTATION_NOTICE_KEY) !== null;
    } catch {
      return false;
    }
  };
  const markNoticeSeen = () => {
    try {
      storage.setItem(DICTATION_NOTICE_KEY, 'vue');
    } catch {
      // A storage that refuses (a private window): the notice shows again next time.
    }
  };

  const end = (reason: Parameters<typeof dictationError>[0]) => {
    handle = null;
    if (timer !== null) clearInterval(timer);
    timer = null;
    error = dictationError(reason);
    if (notice) markNoticeSeen();
    notice = false;
    onChange();
  };

  return {
    view: () => ({
      available: isDictationAvailable(),
      state: handle ? 'dictating' : 'idle',
      elapsedSeconds: handle ? Math.max(0, Math.floor((Date.now() - startedAt) / SECOND)) : 0,
      error,
      notice,
    }),
    get text() {
      return text;
    },
    get dictated() {
      return dictated;
    },
    start(current) {
      if (handle) return;
      before = current;
      text = current;
      error = null;
      notice = !noticeSeen();
      startedAt = Date.now();
      handle = startDictation({
        lang: 'fr-FR',
        onTranscript: (transcript) => {
          text = join(before, transcript);
          if (transcript !== '') dictated = true;
          onChange();
        },
        onEnd: end,
      });
      timer = setInterval(onChange, SECOND);
      onChange();
    },
    stop() {
      handle?.stop();
    },
    reset() {
      handle?.stop();
      before = '';
      text = '';
      dictated = false;
      error = null;
    },
  };
};
