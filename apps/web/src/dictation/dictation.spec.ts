import { t } from '@crewdeck/sdk';
import { DICTATION_MAX_MS, dictationError, isDictationAvailable, startDictation, type DictationEnd } from './dictation.js';
import { fakeSpeech, installFakeSpeech, removeSpeech } from './fake-speech.js';

const listen = () => {
  const transcripts: [string, boolean][] = [];
  const ends: DictationEnd[] = [];
  const handle = startDictation({ lang: 'fr-FR', onTranscript: (text, final) => transcripts.push([text, final]), onEnd: (reason) => ends.push(reason) });
  return { handle, transcripts, ends };
};

describe('dictation', () => {
  beforeEach(() => installFakeSpeech());
  afterEach(() => {
    removeSpeech();
    vi.useRealTimers();
  });

  it('is available with SpeechRecognition or webkitSpeechRecognition, and not without', () => {
    expect(isDictationAvailable()).toBe(true);
    delete (window as unknown as Record<string, unknown>)['SpeechRecognition'];
    expect(isDictationAvailable()).toBe(true);
    removeSpeech();
    expect(isDictationAvailable()).toBe(false);
  });

  it('listens in French, continuously, with interim results', () => {
    listen();
    expect(fakeSpeech().listening).toBe(true);
    expect(fakeSpeech().settings).toEqual({ lang: 'fr-FR', continuous: true, interimResults: true });
  });

  it('gives the whole transcript so far, interim then final, utterance after utterance', () => {
    const { transcripts } = listen();
    fakeSpeech().say('Pouvoir dupliquer', false);
    fakeSpeech().say('Pouvoir dupliquer une recette', true);
    fakeSpeech().say(' pour en faire', false);
    expect(transcripts).toEqual([
      ['Pouvoir dupliquer', false],
      ['Pouvoir dupliquer une recette', true],
      ['Pouvoir dupliquer une recette pour en faire', false],
    ]);
  });

  it('stop() ends it, once, and nothing it hears after counts', () => {
    const { handle, transcripts, ends } = listen();
    handle.stop();
    handle.stop();
    expect(fakeSpeech().listening).toBe(false);
    fakeSpeech().say('trop tard', true);
    expect(transcripts).toEqual([]);
    expect(ends).toEqual(['stopped']);
  });

  it('ends with the API’s own end', () => {
    const { ends } = listen();
    fakeSpeech().end();
    expect(ends).toEqual(['ended']);
  });

  it(`ends by itself after ${DICTATION_MAX_MS / 1000} s`, () => {
    vi.useFakeTimers();
    const { ends } = listen();
    vi.advanceTimersByTime(DICTATION_MAX_MS - 1);
    expect(ends).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ends).toEqual(['timeout']);
    expect(fakeSpeech().listening).toBe(false);
  });

  it.each([
    ['not-allowed', 'not-allowed'],
    ['no-speech', 'no-speech'],
    ['network', 'failed'],
    ['audio-capture', 'failed'],
  ] as const)('an error %s ends it as %s, once', (error, reason) => {
    const { ends } = listen();
    fakeSpeech().fail(error);
    expect(ends).toEqual([reason]);
  });

  it('a recognition that cannot start ends as failed', async () => {
    listen();
    const { ends } = listen();
    await Promise.resolve();
    expect(ends).toEqual(['failed']);
  });

  it('says why an error ended it, and nothing for an end asked or natural', () => {
    expect(dictationError('not-allowed')).toBe('Micro refusé : autorise-le dans ton navigateur.');
    expect(dictationError('no-speech')).toBe('Je n’ai rien entendu.');
    expect(dictationError('failed')).toBe(t('dictation.error.failed'));
    expect(dictationError('failed')).toBe('La dictée s’est arrêtée.');
    for (const reason of ['stopped', 'ended', 'timeout'] as const) expect(dictationError(reason)).toBeNull();
  });
});
