import { t } from '@crewdeck/sdk';

/** The longest a dictation listens: then it stops by itself. */
export const DICTATION_MAX_MS = 60_000;

/**
 * Why a dictation ended: asked (`stopped`), by the browser (`ended`), after
 * `DICTATION_MAX_MS` (`timeout`), or on the browser's error.
 */
export type DictationEnd = 'stopped' | 'ended' | 'timeout' | 'not-allowed' | 'no-speech' | 'failed';

export interface DictationOptions {
  /** `fr-FR` at the MVP: the UI is in French. */
  readonly lang: string;
  /** The whole transcript so far, `final` once its last words are settled. */
  onTranscript(text: string, final: boolean): void;
  /** Once, however it ends. */
  onEnd(reason: DictationEnd): void;
}

export interface DictationHandle {
  stop(): void;
}

/** The part of the Web Speech API this uses: no type of it in TypeScript's DOM. */
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
}

type RecognitionConstructor = new () => Recognition;

const recognitionConstructor = (): RecognitionConstructor | undefined => {
  const speech = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
};

/** Whether this browser can dictate (ADR 0007): without it, no « Dicter », keyboard dictation still works. */
export const isDictationAvailable = (): boolean => recognitionConstructor() !== undefined;

const ERRORS: Readonly<Record<string, DictationEnd>> = { 'not-allowed': 'not-allowed', 'no-speech': 'no-speech' };

const transcriptOf = (results: SpeechRecognitionResultList): { text: string; final: boolean } => {
  const parts: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const words = results[index]?.[0]?.transcript.trim();
    if (words) parts.push(words);
  }
  return { text: parts.join(' '), final: results.length > 0 && results[results.length - 1]?.isFinal === true };
};

/**
 * Listens through the browser's Web Speech API (US-57, ADR 0007),
 * continuously and with interim results: the audio goes to the browser's own
 * service (risk SEC-9), never to Crewdeck, and the transcript stays in the
 * page. It ends on `stop()`, on the API's end, after `DICTATION_MAX_MS` or on
 * an error; nothing heard after counts.
 */
export const startDictation = ({ lang, onTranscript, onEnd }: DictationOptions): DictationHandle => {
  const Speech = recognitionConstructor();
  let ended = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const recognition = Speech ? new Speech() : null;

  const onResult = (event: Event) => {
    const { text, final } = transcriptOf((event as SpeechRecognitionEvent).results);
    onTranscript(text, final);
  };
  const onError = (event: Event) => finish(ERRORS[(event as SpeechRecognitionErrorEvent).error] ?? 'failed');
  const onApiEnd = () => finish('ended');

  function finish(reason: DictationEnd): void {
    if (ended) return;
    ended = true;
    clearTimeout(timeout);
    if (recognition) {
      recognition.removeEventListener('result', onResult);
      recognition.removeEventListener('error', onError);
      recognition.removeEventListener('end', onApiEnd);
      if (reason === 'stopped' || reason === 'timeout') recognition.stop();
    }
    onEnd(reason);
  }

  if (!recognition) {
    queueMicrotask(() => finish('failed'));
    return { stop: () => finish('stopped') };
  }
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.addEventListener('result', onResult);
  recognition.addEventListener('error', onError);
  recognition.addEventListener('end', onApiEnd);
  try {
    recognition.start();
  } catch {
    // Started already elsewhere, or refused at once: it ends as an error, after this returns.
    queueMicrotask(() => finish('failed'));
    return { stop: () => finish('stopped') };
  }
  timeout = setTimeout(() => finish('timeout'), DICTATION_MAX_MS);
  return { stop: () => finish('stopped') };
};

/** What the field says after a dictation ended on an error, or `null`. */
export const dictationError = (reason: DictationEnd): string | null => {
  if (reason === 'not-allowed') return t('dictation.error.notAllowed');
  if (reason === 'no-speech') return t('dictation.error.noSpeech');
  if (reason === 'failed') return t('dictation.error.failed');
  return null;
};
